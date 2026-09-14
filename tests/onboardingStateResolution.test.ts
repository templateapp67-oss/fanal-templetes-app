// ============================================================================
// PHASE 8 — ONBOARDING STATE AUDIT
//
// The question this suite answers, with the real schema and the real reader:
// **where does the application already keep the state of an owner's
// onboarding, and does it need anything new?**
//
// The seven states the audit had to locate:
//
//   new owner · onboarding incomplete · business details saved ·
//   template selected · editor started · website published · onboarding completed
//
// and the six objects it had to look for first:
//
//   onboarding_status · setup_status · workspace_status ·
//   profile completion · salon state · website config
//
// Three things are asserted here, none of them from a comment:
//
//   1. Every state is readable from tables that ALREADY exist — driven through
//      the production reader (`readOwnerEntryFacts` + `classifyOwnerEntry` from
//      `src/lib/ownerEntryRoute.ts`, the code App.tsx actually runs) against a
//      database built from the committed migrations. Nothing is stubbed: real
//      signup trigger, real SECURITY DEFINER RPCs, real RLS, real save path.
//   2. The parallel objects the task warns about do NOT exist — `onboarding_sessions`,
//      `setup_status`, `workspace_status`, `profile_completion`, a template
//      column, a published flag — in the database OR in any committed
//      migration OR in `src/`. **This phase adds no table and no column.**
//   3. The two real gaps that DO exist are derivation/coverage gaps, not
//      storage gaps, and they are pinned here so they cannot be mistaken for
//      "working" later (see 8.4 and 8.9).
//
// Schema generation: production is the NORMALIZED one (organizations +
// organization_members + salons), applied outside this repository and mirrored
// by `tests/liveSchemaFixture.ts`. The committed growth chain (incl. PART 3 and
// the signup trigger) is applied on top, exactly like the local gateway does.
// ============================================================================

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { before, test } from 'node:test';
import { asUser, liveSchemaDb } from './liveSchemaFixture';
import { LOCAL_GROWTH_CHAIN } from '../server/localSupabase';
import {
  classifyOwnerEntry,
  describeOwnerEntry,
  ownerEntryView,
  ownerEntryWizardStep,
  readOwnerEntryFacts,
  type OwnerEntryFacts,
} from '../src/lib/ownerEntryRoute';
import { phaseFromOnboardingState, resolveOnboardingRoute } from '../src/onboarding/lib/flow';

const MIGRATION = (file: string) =>
  readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const MIGRATION_FILES = readdirSync(new URL('../supabase/migrations/', import.meta.url));

/** Migrations the application owns that are NOT part of the growth chain. */
const OWNER_STATE_MIGRATIONS = [
  '20260909045308_contact_profile_wiring.sql', // owner_editor_state + get_owner_editor_state()
  '20260909142000_normalized_owner_workspace.sql', // the real editor save transaction
];

/**
 * Columns the live-schema fixture deliberately omits (it models what the SERVER
 * reads), but which production has and the owner-state migrations touch. Same
 * role as the PRODUCTION_GAPS preamble in the PART 3 suite: fixture gap, not a
 * product gap.
 */
const FIXTURE_GAPS = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  alter default privileges in schema public grant execute on functions to service_role;

  create schema if not exists private;
  create or replace function private.is_admin() returns boolean language sql stable as
    $$ select coalesce(nullif(current_setting('app.is_admin', true), ''), 'false') = 'true' $$;
  grant usage on schema private to authenticated, anon;
  grant execute on function private.is_admin() to authenticated, anon;

  -- 00001's profiles shape (columns trimmed to those the state path touches).
  create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text, salon_name text, business_type text, email text, phone_number text,
    whatsapp text, owner_role text, subdomain text unique, city text, state text,
    mobile text, phone text, pincode text, preferred_city text, area text,
    preferred_area text, avatar_url text, photo_url text,
    updated_at timestamptz not null default now()
  );
  alter table public.profiles enable row level security;
  grant select on public.profiles to authenticated;
  drop policy if exists profiles_select_owner on public.profiles;
  create policy profiles_select_owner on public.profiles for select using (id = auth.uid());

  alter table auth.users add column if not exists email text;
  alter table auth.users add column if not exists encrypted_password text;
  alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;
  alter table auth.users add column if not exists banned_until timestamptz;
  alter table auth.users add column if not exists created_at timestamptz not null default now();
  alter table auth.users add column if not exists last_sign_in_at timestamptz;
  alter table auth.users add column if not exists email_confirmed_at timestamptz;

  -- Production salon columns the owner-state path and the public site read
  -- (server/siteLookup.ts filters on slug + is_active; nexora_owner_salon_ids
  -- filters deleted_at; sync_owner_contact writes the contact columns).
  alter table public.salons add column if not exists deleted_at timestamptz;
  alter table public.salons add column if not exists owner_id uuid;
  alter table public.salons add column if not exists is_active boolean not null default true;
  alter table public.salons add column if not exists verified boolean not null default false;
  alter table public.salons add column if not exists mobile text;
  alter table public.salons add column if not exists email text;
  alter table public.salons add column if not exists area text;
  alter table public.salons add column if not exists state text;
  alter table public.salons add column if not exists pincode text;
  alter table public.salons add column if not exists landmark text;

  -- Production declares the site address unique (20261002 creates salons with
  -- \`slug text not null unique\`, and siteLookup resolves one row by slug). The
  -- fixture omits the constraint; ensure_owner_workspace()'s collision retry is
  -- driven by unique_violation, so without it every owner would get the same
  -- slug. Fixture gap, not product behaviour.
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'salons_slug_key') then
      alter table public.salons add constraint salons_slug_key unique (slug);
    end if;
  end $$;

  -- 20260909142000's compatibility block resolves this table by name.
  create table if not exists public.salon_staff (
    id uuid primary key default gen_random_uuid(), salon_id uuid, staff_id uuid
  );

  grant usage on schema auth to authenticated, anon;
`;

let db: any;

before(async () => {
  db = await liveSchemaDb();
  await db.exec(FIXTURE_GAPS);
  for (const file of LOCAL_GROWTH_CHAIN) await db.exec(MIGRATION(file));
  for (const file of OWNER_STATE_MIGRATIONS) await db.exec(MIGRATION(file));
});

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

const PARTNER = 'f0000000-0000-4000-8000-00000000000a';
const ADMIN = 'f0000000-0000-4000-8000-00000000000f';

let seq = 0;
/** A fresh owner id per call, so tests share the database without sharing state. */
function ownerId(): string {
  seq += 1;
  return `e0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

/** Real signup: the `on_auth_user_created` trigger creates the profiles row. */
async function signUp(id: string, email: string, meta: Record<string, unknown> = {}) {
  await db.query(
    'insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values($1,$2,$3,$4::jsonb)',
    [id, email, 'test-only', JSON.stringify({ full_name: 'Owner', salon_name: 'Owner Salon', phone_number: '+919000000000', ...meta })]
  );
  return id;
}

/** Call an RPC as the signed-in owner (role `authenticated`). */
async function rpc(who: string, fn: string, args: any[] = []): Promise<any> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
  const result = await asUser(db, who, `select public.${fn}(${placeholders}) as r`, args);
  return result.rows[0].r;
}

/** The SQL Editor / service-key path (admin-only RPCs). */
async function rpcAdmin(fn: string, args: any[] = [], actor = ADMIN): Promise<any> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
  await db.query("select set_config('app.is_admin', 'true', false)");
  await db.exec('reset role');
  await db.exec('set role service_role');
  try {
    return (await db.query(`select public.${fn}(${placeholders}) as r`, args)).rows[0].r;
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.query("select set_config('app.is_admin', 'false', false)");
  }
}

/**
 * The production reader's client surface (`rpc` + `from(...).select().limit()`),
 * backed by the real database as the real role. PostgREST turns a SQL failure
 * into `{ data: null, error: { message } }` — so does this, which is what makes
 * the reader's "never guess" branches testable for real.
 */
function readerClient(who: string) {
  return {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      const names = Object.keys(args);
      const values = names.map((name) => args[name]);
      const placeholders = names.map((_, index) => `$${index + 1}`).join(', ');
      try {
        const result = await asUser(db, who, `select public.${fn}(${placeholders}) as r`, values);
        return { data: result.rows[0]?.r ?? null, error: null };
      } catch (error) {
        return { data: null, error: { message: String((error as Error).message) } };
      }
    },
    from: (table: string) => ({
      select: () => ({
        limit: async (count: number) => {
          try {
            const result = await asUser(db, who, `select id from public.${table} limit ${count}`);
            return { data: result.rows, error: null };
          } catch (error) {
            return { data: null, error: { message: String((error as Error).message) } };
          }
        },
      }),
    }),
  };
}

/** The production reader, then the production classifier — exactly App.tsx's path. */
async function stageOf(who: string) {
  const facts = await readOwnerEntryFacts(readerClient(who) as any);
  const stage = classifyOwnerEntry(facts);
  return { facts, stage, view: ownerEntryView(stage), wizardStep: ownerEntryWizardStep(stage) };
}

/** PART 3: the workspace the owner's first save needs (idempotent). */
const provisionWorkspace = (who: string) => rpc(who, 'ensure_owner_workspace');

/** The REAL editor save: nexora_save_owner_workspace via save_owner_editor_state. */
async function saveBusiness(
  who: string,
  profile: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): Promise<void> {
  await provisionWorkspace(who);
  const state = {
    profile: {
      businessName: 'Owner Salon',
      ownerName: 'Owner',
      phone: '+919000000000',
      city: 'Jaipur',
      subdomain: 'owner-salon',
      ...profile,
    },
    services: [{ id: 'svc-1', name: 'Signature Cut', price: 500, durationMinutes: 30 }],
    stylists: [],
    loyaltyConfig: { pointsPerVisit: 10 },
    ...extra,
  };
  await rpc(who, 'save_owner_editor_state', [state]);
}

/** A real partner account, provisioned once for every test that needs one. */
async function ensurePartner(): Promise<string> {
  const exists = (await db.query('select 1 from auth.users where id = $1', [PARTNER])).rows.length > 0;
  if (!exists) await signUp(PARTNER, 'state.partner@example.com', { full_name: 'Partner' });
  return (await rpcAdmin('provision_growth_partner', [PARTNER])).referral_code as string;
}

const funnelRow = async (who: string) =>
  (await db.query('select * from public.growth_onboarding where user_id = $1', [who])).rows[0];
const editorState = async (who: string) =>
  (await db.query('select * from public.owner_editor_state where owner_id = $1', [who])).rows[0];
const salonOf = async (who: string) =>
  (await db.query(
    `select s.* from public.salons s
     join public.organization_members m on m.organization_id = s.organization_id
     where m.user_id = $1 and m.status = 'active' and m.role in ('owner','manager')
     order by s.updated_at limit 1`,
    [who]
  )).rows[0];

// ===========================================================================
// 8.1 — the state inventory (and the objects that must NOT exist)
// ===========================================================================

test('8.1 the whole onboarding state already lives in five existing objects, and nothing named like a parallel one exists', async () => {
  // What carries the seven states. Asserted as an exact list, so a future
  // migration that moves or duplicates this state fails here.
  const columns = (
    await db.query(
      `select table_name || '.' || column_name as column
       from information_schema.columns
       where table_schema = 'public' and (
         (table_name = 'growth_onboarding' and column_name in
            ('status','linked_at','growth_partner_id','template_started_at','template_completed_at')) or
         (table_name = 'owner_editor_state' and column_name in ('owner_id','state','updated_at')) or
         (table_name = 'organization_members' and column_name in ('role','status')) or
         (table_name = 'salons' and column_name in ('slug','name','is_active','deleted_at','data')) or
         (table_name = 'services' and column_name in ('salon_id','is_active'))
       ) order by 1`
    )
  ).rows.map((row: any) => row.column);
  assert.deepEqual(columns, [
    'growth_onboarding.growth_partner_id',
    'growth_onboarding.linked_at',
    'growth_onboarding.status',
    'growth_onboarding.template_completed_at',
    'growth_onboarding.template_started_at',
    'organization_members.role',
    'organization_members.status',
    'owner_editor_state.owner_id',
    'owner_editor_state.state',
    'owner_editor_state.updated_at',
    'salons.data',
    'salons.deleted_at',
    'salons.is_active',
    'salons.name',
    'salons.slug',
    'services.is_active',
    'services.salon_id',
  ]);

  // The funnel row is the ONLY onboarding-named object, and it holds no
  // 'onboarding' column: there is no `onboarding_status`/`setup_status`/
  // `workspace_status`/`profile_completion` anywhere in the database.
  const onboardingTables = (
    await db.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name like '%onboarding%' order by 1`
    )
  ).rows.map((row: any) => row.table_name);
  assert.deepEqual(onboardingTables, ['growth_onboarding']);

  const parallelNames = /onboarding_sessions|setup_status|workspace_status|profile_completion|onboarding_step|wizard_state|is_published|published_at/;
  const parallelColumns = (
    await db.query(
      `select table_name || '.' || column_name as column from information_schema.columns
       where table_schema = 'public' and (column_name ~* $1 or table_name ~* $1) order by 1`,
      ['onboarding_sessions|setup_status|workspace_status|profile_completion|onboarding_step|wizard_state|is_published|published_at']
    )
  ).rows.map((row: any) => row.column);
  assert.deepEqual(parallelColumns, [], `unexpected state object(s): ${parallelColumns.join(', ')}`);

  // …and none is hiding in a migration or in the application source either, so
  // "reuse the existing state" is a property of the branch, not of one run.
  const migrations = MIGRATION_FILES.filter((file) => file.endsWith('.sql')).map((file) => MIGRATION(file));
  assert.ok(migrations.length >= 45, `migration inventory: ${migrations.length}`);
  for (const source of migrations) {
    assert.doesNotMatch(source, parallelNames, 'a migration defines a parallel state object');
  }
  for (const file of ['src/App.tsx', 'src/lib/ownerEntryRoute.ts', 'src/lib/salonStore.ts', 'src/lib/growthPartner.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, parallelNames, `${file} references a parallel state object`);
  }

  // 8.1 verdict, stated as the reason no schema change is needed: each of the
  // seven states has a home in the list above. The tests below execute it.
  assert.equal(ownerEntryView('no-workspace'), 'wizard');
  assert.equal(ownerEntryView('editor-started'), 'wizard');
  assert.equal(ownerEntryView('published'), 'dashboard');
});

// ===========================================================================
// 8.2 — new owner
// ===========================================================================

test('8.2 a new owner is: profiles row + not_started funnel + no workspace + no editor state', async () => {
  const newOwner = await signUp(ownerId(), 'state.new@example.com', { full_name: 'New Owner' });

  // The signup trigger (00001:84, replaced by 20261003) is what makes them
  // "an owner" at all — no onboarding row is created by signing up.
  const profile = (await db.query('select id, full_name, phone_number from public.profiles where id = $1', [newOwner])).rows[0];
  assert.equal(profile.full_name, 'New Owner');
  assert.equal(profile.phone_number, '+919000000000');
  assert.equal(await funnelRow(newOwner), undefined, 'signup creates no onboarding row');

  const status = await rpc(newOwner, 'get_my_onboarding_status');
  assert.equal(status.status, 'not_started');
  assert.equal(status.linked, false);
  assert.equal(status.template_started_at, null);

  const workspace = await rpc(newOwner, 'get_my_owner_workspace');
  assert.equal(workspace.resolved, false);
  assert.equal(workspace.salon_count, 0);
  assert.equal(await rpc(newOwner, 'get_owner_editor_state'), null);

  const { facts, stage, view, wizardStep } = await stageOf(newOwner);
  assert.equal(stage, 'no-workspace');
  assert.equal(view, 'wizard');
  assert.equal(wizardStep, 1, 'a brand-new owner starts at the template chooser');
  assert.match(describeOwnerEntry(stage, facts), /stage=no-workspace profile=yes workspace=missing onboarding=not_started editor=empty template=none/);
});

// ===========================================================================
// 8.3 — business details saved
// ===========================================================================

test('8.3 "business details saved" is the existing save transaction: owner_editor_state.state.profile + the salon row + profiles contact columns', async () => {
  const saver = await signUp(ownerId(), 'state.saved@example.com');
  assert.equal((await stageOf(saver)).stage, 'no-workspace');

  // "Onboarding incomplete": the workspace exists (the PART 3 step ran) and
  // nothing has been built into it yet.
  await provisionWorkspace(saver);
  const incomplete = await stageOf(saver);
  assert.equal(incomplete.facts.workspaceResolved, true);
  assert.equal(incomplete.stage, 'onboarding-incomplete');
  assert.equal(incomplete.view, 'wizard');

  await saveBusiness(saver, { businessName: 'Saved Salon', city: 'Jaipur' }, { selectedTemplateId: 'hair' });

  // One transaction, three durable homes — no fourth "business details" flag.
  const state = await editorState(saver);
  assert.equal(state.state.profile.businessName, 'Saved Salon');
  assert.equal(state.state.profile.city, 'Jaipur');
  assert.ok(state.updated_at instanceof Date);

  const salon = await salonOf(saver);
  assert.equal(salon.name, 'Saved Salon', 'salons.name is the business name the public site serves');
  assert.ok(String(salon.slug).trim(), 'ensure_owner_workspace() gave the salon its address');
  assert.equal(salon.data.editor_profile.businessName, 'Saved Salon');

  const contact = (
    await db.query('select full_name, phone, city from public.profiles where id = $1', [saver])
  ).rows[0];
  assert.equal(contact.phone, '+919000000000', 'sync_owner_contact() wrote the owner contact columns');
  assert.equal(contact.city, 'Jaipur');

  // And the reader sees exactly that, through the existing RPC.
  const { facts, stage, view } = await stageOf(saver);
  assert.equal(facts.hasEditorState, true);
  assert.equal(stage, 'editor-started');
  assert.equal(view, 'wizard');
  assert.deepEqual(await rpc(saver, 'get_my_owner_workspace').then((w: any) => w.resolved), true);
});

// ===========================================================================
// 8.4 — template selected (and the one unreachable stage)
// ===========================================================================

test('8.4 the chosen template is stored in the existing editor state — and the "template-selected" stage cannot be reached from it', async () => {
  const chooser = await signUp(ownerId(), 'state.template@example.com');
  await saveBusiness(chooser, {}, { selectedTemplateId: 'nails' });

  // Nowhere else: no template column exists in the schema at all.
  const templateColumns = (
    await db.query(
      `select table_name || '.' || column_name as column from information_schema.columns
       where table_schema = 'public' and column_name ~* 'template' order by 1`
    )
  ).rows.map((row: any) => row.column);
  assert.deepEqual(
    templateColumns,
    ['growth_onboarding.template_completed_at', 'growth_onboarding.template_started_at'],
    'the only template columns are the funnel milestones — a CHOSEN template is state, not a column'
  );

  const state = await editorState(chooser);
  assert.equal(state.state.selectedTemplateId, 'nails');
  assert.equal((await rpc(chooser, 'get_owner_editor_state')).selectedTemplateId, 'nails');

  const { facts } = await stageOf(chooser);
  assert.equal(facts.templateId, 'nails', 'the reader does expose the chosen template');

  // FINDING (derivation gap, not a storage gap): `templateId` is read from the
  // same response that proves the editor has state, so "a template was chosen
  // but nothing was saved yet" is not an observable state — the classifier's
  // `template-selected` branch is unreachable for any fact set the reader can
  // produce, and both cases correctly land on step 2 of the wizard.
  const reachable = await readOwnerEntryFacts(readerClient(chooser) as any);
  assert.equal(classifyOwnerEntry(reachable), 'editor-started');
  assert.equal(ownerEntryWizardStep('template-selected'), ownerEntryWizardStep('editor-started'));

  // Exhaustive over the shapes the reader can return from
  // `get_owner_editor_state`: any object sets hasEditorState, so the stage can
  // only be produced by a fact set the reader never emits.
  const editorResponses: Array<{ label: string; data: any }> = [
    { label: 'null', data: null },
    { label: 'empty object', data: {} },
    { label: 'template only', data: { selectedTemplateId: 'hair' } },
    { label: 'full state', data: { profile: {}, services: [], selectedTemplateId: 'hair' } },
  ];
  const statuses = ['', 'not_started', 'linked', 'template_started'];
  for (const response of editorResponses) {
    for (const status of statuses) {
      const facts: OwnerEntryFacts = {
        hasProfile: true,
        profileReadOk: true,
        workspaceSupported: true,
        workspaceResolved: true,
        workspaceAmbiguous: false,
        onboardingStatus: status,
        hasEditorState: response.data !== null,
        templateId: response.data?.selectedTemplateId ?? null,
      };
      assert.notEqual(
        classifyOwnerEntry(facts),
        'template-selected',
        `${response.label} / ${status || 'unread'} produced the unreachable stage`
      );
    }
  }
  // The stage itself still exists and is well-formed — it is simply fed by a
  // combination the reader cannot produce.
  assert.equal(
    classifyOwnerEntry({ ...reachable, hasEditorState: false, templateId: 'hair' }),
    'template-selected'
  );
});

// ===========================================================================
// 8.5 — editor started
// ===========================================================================

test('8.5 "editor started" has two existing signals — the editor state row and the funnel milestone', async () => {
  const editor = await signUp(ownerId(), 'state.editor@example.com');

  // Signal 1: the referral funnel's own milestone. It works without a partner
  // (the RPC creates the row), so it is not referral-only state.
  const started = await rpc(editor, 'update_my_onboarding_progress', ['start_template']);
  assert.equal(started.status, 'template_started');
  assert.equal(started.linked, false);
  assert.ok((await funnelRow(editor)).template_started_at);

  // Signal 2: the editor state the reader uses for routing.
  await saveBusiness(editor);
  const { facts, stage, wizardStep } = await stageOf(editor);
  assert.equal(facts.hasEditorState, true);
  assert.equal(facts.onboardingStatus, 'template_started');
  assert.equal(stage, 'editor-started');
  assert.equal(wizardStep, 2, 'an owner who already started editing does not re-pick a template');

  // Starting twice is a no-op — the milestone is forward-only.
  const again = await rpc(editor, 'update_my_onboarding_progress', ['start_template']);
  assert.equal(again.status, 'template_started');
  assert.equal(again.template_started_at, started.template_started_at);
});

// ===========================================================================
// 8.6 — website published
// ===========================================================================

test('8.6 "published" is derived from the salon row + the verified completion, not from a published flag', async () => {
  const publisher = await signUp(ownerId(), 'state.published@example.com');
  // Enter the funnel first (the milestone the Template App sets, 20260913:254).
  // A completion with no funnel row cannot record anything at all — that is the
  // gap pinned in 8.9 — so the refusal tested below is the *verified website*
  // refusal, not the missing-row one.
  await rpc(publisher, 'update_my_onboarding_progress', ['start_template']);
  await assert.rejects(
    () => rpc(publisher, 'complete_template_onboarding'),
    /Your website setup is not complete yet/i,
    'nothing built yet: the backend refuses to call that complete'
  );
  assert.equal((await rpc(publisher, 'get_my_onboarding_status')).status, 'template_started');

  await saveBusiness(publisher, { businessName: 'Published Salon' });
  assert.equal((await stageOf(publisher)).stage, 'editor-started');

  // The serving contract (server/siteLookup.ts): a live public site is a salon
  // row with a slug and is_active — which the same workspace/save path wrote.
  const salon = await salonOf(publisher);
  assert.equal(salon.is_active, true);
  assert.equal(salon.deleted_at, null);
  const publicRows = await db.query(
    'select id from public.salons where slug = $1 and is_active = true and deleted_at is null',
    [salon.slug]
  );
  assert.equal(publicRows.rows.length, 1, 'the salon is addressable as a public site');

  // The funnel contract: the completion event is what flips the milestone.
  const completed = await rpc(publisher, 'complete_template_onboarding');
  assert.equal(completed.completed, true);
  assert.equal(completed.status, 'template_completed');

  const { stage, view } = await stageOf(publisher);
  assert.equal(stage, 'published');
  assert.equal(view, 'dashboard', 'a published owner lands on their business, not the wizard');
});

// ===========================================================================
// 8.7 — onboarding completed
// ===========================================================================

test('8.7 "onboarding completed" is the funnel row: template_completed + server timestamps, idempotent', async () => {
  const finisher = await signUp(ownerId(), 'state.complete@example.com');
  await rpc(finisher, 'link_my_growth_referral', [await ensurePartner()]);
  await rpc(finisher, 'update_my_onboarding_progress', ['start_template']);
  await saveBusiness(finisher);
  const first = await rpc(finisher, 'complete_template_onboarding');
  assert.equal(first.status, 'template_completed');
  assert.equal(first.completed, true);
  assert.ok(first.template_started_at, 'the completion backfills the start it did not see');
  assert.ok(first.template_completed_at);

  const second = await rpc(finisher, 'complete_template_onboarding');
  assert.equal(second.completed, true, 'a repeat completion is a success, not an error');
  assert.equal(second.template_completed_at, first.template_completed_at, 'timestamps are never re-written');
  assert.equal((await funnelRow(finisher)).status, 'template_completed');

  // The two client derivations already in the codebase agree with the row.
  assert.equal(phaseFromOnboardingState({ status: first.status, linked: first.linked }), 'completed');
  assert.equal(
    resolveOnboardingRoute({ hasSession: true, phase: 'completed', requested: 'referral' }),
    'status'
  );

  // The Onboarding App's phase mapper is referral-centric on purpose ("linked
  // is authoritative"): a DIRECT owner whose onboarding row says completed is
  // reported as 'pending' there. That is the same referral-gating the routing
  // audit hit in 8.9, seen from the funnel's side.
  assert.equal(phaseFromOnboardingState({ status: 'template_completed', linked: false }), 'pending');
});

// ===========================================================================
// 8.8 — how the funnel milestone is reached (referred vs direct owners)
// ===========================================================================

test('8.8 the funnel row is not referral-only, but the app\'s entry into the Template App is', async () => {
  // A direct owner (no referral at all).
  const direct = await signUp(ownerId(), 'state.direct@example.com');
  await assert.rejects(
    () => rpc(direct, 'create_template_handoff'),
    /A verified referral is required before entering the Template App/i,
    'the handoff is referral-gated (20260913:133) — a direct owner never gets a funnel row through it'
  );
  assert.equal(await funnelRow(direct), undefined);

  // …but the funnel table itself is happy to hold a non-referred owner, and
  // the progress RPC creates the row without a partner.
  await rpc(direct, 'update_my_onboarding_progress', ['start_template']);
  const row = await funnelRow(direct);
  assert.equal(row.status, 'template_started');
  assert.equal(row.growth_partner_id, null);

  // A referred owner gets the same milestone from the handoff exchange.
  const code = await ensurePartner();
  const referred = await signUp(ownerId(), 'state.referred@example.com');
  await rpc(referred, 'link_my_growth_referral', [code]);
  assert.equal((await funnelRow(referred)).status, 'linked');

  const grant = await rpc(referred, 'create_template_handoff');
  const exchanged = await rpc(referred, 'exchange_template_handoff', [grant.token]);
  assert.equal(exchanged.onboarding_status, 'template_started');
  assert.ok(exchanged.template_started_at);
  assert.equal((await funnelRow(referred)).growth_partner_id, PARTNER);

  // Both owners reach the same stage for the same reason: the milestone.
  assert.equal((await stageOf(referred)).facts.onboardingStatus, 'template_started');
  assert.equal((await stageOf(direct)).facts.onboardingStatus, 'template_started');
});

// ===========================================================================
// 8.9 — the one real coverage gap
// ===========================================================================

test('8.9 GAP: a direct owner who finishes their website is never recorded as completed', async () => {
  const direct = await signUp(ownerId(), 'state.gap@example.com');
  await saveBusiness(direct, { businessName: 'Gap Salon' });

  // Their website is finished: the salon is named by the save and the workspace
  // carries an active service (fixture seed) — which is the same shape the
  // verification requires.
  const salon = await salonOf(direct);
  assert.ok(String(salon.name).trim() && String(salon.slug).trim());

  // The completion event is a no-op for them: nothing is created, and the
  // owner's real completion is invisible to every server-side reader.
  const result = await rpc(direct, 'complete_template_onboarding');
  assert.equal(result.completed, false);
  assert.equal(result.status, 'not_started');
  assert.equal(await funnelRow(direct), undefined, 'still no row: completion did not create onboarding state');
  assert.equal((await stageOf(direct)).facts.onboardingStatus, 'not_started');

  // Proof that the website WAS complete and the row was the only missing
  // ingredient: create the row through the existing start path and the very
  // next completion call succeeds on the unchanged database.
  await rpc(direct, 'update_my_onboarding_progress', ['start_template']);
  const afterRow = await rpc(direct, 'complete_template_onboarding');
  assert.equal(afterRow.completed, true);
  assert.equal(afterRow.status, 'template_completed');

  // The consequence, on a second direct owner who was never given a row: their
  // website is complete and saved, and the owner app still routes them to the
  // editor — 'published' is unreachable without the funnel row, even though
  // every other signal (salon, slug, services, editor state) says finished.
  const finishedDirect = await signUp(ownerId(), 'state.gap2@example.com');
  await saveBusiness(finishedDirect, { businessName: 'Finished Salon' });
  const finishedSalon = await salonOf(finishedDirect);
  const activeServices = (
    await db.query('select count(*)::int as count from public.services where salon_id = $1 and is_active', [finishedSalon.id])
  ).rows[0].count;
  assert.ok(activeServices > 0, 'a named, slugged salon with an active service — the verified shape');
  const stillEditing = await stageOf(finishedDirect);
  assert.equal(stillEditing.facts.hasEditorState, true);
  assert.equal(stillEditing.stage, 'editor-started');
  assert.equal(stillEditing.view, 'wizard', 'not the dashboard a published owner gets');
  assert.equal(stillEditing.wizardStep, 2);

  // What the server does know about a direct owner is only these three things.
  const signals = {
    editorState: Boolean(await editorState(direct)),
    salonSlug: salon.slug,
    funnelStatus: (await funnelRow(direct)).status,
  };
  assert.deepEqual(Object.keys(signals).sort(), ['editorState', 'funnelStatus', 'salonSlug']);
});

// ===========================================================================
// 8.10 — the resolution is complete: every state the product has, named
// ===========================================================================

test('8.10 the reachable stage set covers the requested states, and every one of them is read from existing tables', async () => {
  const walk = await signUp(ownerId(), 'state.walk@example.com');
  const seen: string[] = [];

  seen.push((await stageOf(walk)).stage); // new owner, nothing but a profile
  await provisionWorkspace(walk);
  seen.push((await stageOf(walk)).stage); // workspace, nothing built yet
  await saveBusiness(walk);
  seen.push((await stageOf(walk)).stage); // editor started / template selected
  const beforeComplete = await stageOf(walk);
  await rpc(walk, 'update_my_onboarding_progress', ['start_template']);
  await rpc(walk, 'complete_template_onboarding');
  seen.push((await stageOf(walk)).stage); // published

  assert.deepEqual(seen, ['no-workspace', 'onboarding-incomplete', 'editor-started', 'published']);

  // The "never guess" answers, which are what keep the seven states honest.
  const unreadable = await readOwnerEntryFacts({
    rpc: async () => ({ data: null, error: { message: 'network unreachable' } }),
    from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { message: 'failed' } }) }) }),
  } as any);
  assert.equal(unreadable.profileReadOk, false);
  assert.equal(classifyOwnerEntry(unreadable), 'unknown');
  assert.equal(ownerEntryView('unknown'), 'landing', 'an unreadable state moves nobody');

  // And the whole walk is derived from tables that existed before this phase:
  // the reader above issued exactly these four reads.
  const reads = ['profiles', 'get_my_owner_workspace', 'get_my_onboarding_status', 'get_owner_editor_state'];
  const source = readFileSync(new URL('../src/lib/ownerEntryRoute.ts', import.meta.url), 'utf8');
  for (const read of reads) assert.ok(source.includes(read), `the reader still uses ${read}`);
  assert.equal(beforeComplete.stage, 'editor-started');
});
