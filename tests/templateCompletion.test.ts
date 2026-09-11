// ============================================================================
// Phase 5 — verified website-completion tracking + onboarding completion flow.
//
// Backend (PGlite, live normalized schema + growth/handoff/completion stack):
//   • complete_template_onboarding(): verified completion for the session
//     caller (no user_id argument), idempotent, server-timestamped, atomic
//   • verification = active owner/manager org + named slugged salon + an
//     active service (NULL is_active counts as active — the Template App
//     itself reads `row.is_active ?? true` in src/App.tsx)
//   • unfinished websites reject with the safe "not complete yet" message and
//     change nothing; no cross-user leakage; anon denied; referral ownership
//     immutable; no funnel row → no-op (nothing created)
//   • the legacy stepper's complete branch enforces the SAME verification
//     (no bypass), while still requiring a prior start
//   • partners see the completed referral through the existing shared row
//   • full journey: link → handoff entry → setup → verified completion →
//     relogin recognized, no duplicates
// Frontend (static + SSR): completion fires only after a successful explicit
// cloud save; the success dialog keeps its save state and shows the note only
// when the backend reports not-ready; the onboarding status screen shows a
// completed ready state with a plain Template App link (no token, no
// referral/handoff/signup repeated); no localStorage completion decisions.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  liveSchemaDb,
  asUser,
  OWNER,
  OTHER_OWNER,
  CUSTOMER_USER,
  ORG,
  SALON,
  OTHER_SALON,
  SERVICE,
  OTHER_SERVICE,
} from './liveSchemaFixture';
import {
  StatusScreen,
  STATUS_COMPLETED_TITLE,
  STATUS_COMPLETED_BODY,
  STATUS_VERIFIED_TITLE,
} from '../src/onboarding/screens/StatusScreen';
import { WebsiteSavedModal } from '../src/components/WebsiteSavedModal';
import {
  isCompletionNotReadyError,
  toCompletionError,
  TEMPLATE_COMPLETION_NOT_READY_MESSAGE,
  TEMPLATE_COMPLETION_GENERIC_MESSAGE,
} from '../src/lib/growthPartner';
import { phaseFromOnboardingState, resolveOnboardingRoute } from '../src/onboarding/lib/flow';

const PARTNER = 'a0000000-0000-4000-8000-000000000001';
const PARTNER_2 = 'a0000000-0000-4000-8000-000000000002';
const CODE = 'GAMMA03';
const CODE_2 = 'DELTA04';

const GROWTH_MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260912_growth_partner_onboarding.sql', import.meta.url),
  'utf8'
);
const HANDOFF_MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260913_template_handoff.sql', import.meta.url),
  'utf8'
);
const COMPLETION_MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260914_template_completion.sql', import.meta.url),
  'utf8'
);

/** Live normalized schema + migrations in chronological order (like db push). */
async function setup(withHandoff = false): Promise<any> {
  const db = await liveSchemaDb();
  await db.exec(GROWTH_MIGRATION);
  if (withHandoff) await db.exec(HANDOFF_MIGRATION);
  await db.exec(COMPLETION_MIGRATION);
  return db;
}

/** Call an RPC as an authenticated user; returns the parsed jsonb result. */
async function rpc(db: any, userId: string, fn: string, args: any[] = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const res = await asUser(db, userId, `select public.${fn}(${placeholders}) as result`, args);
  return res.rows[0].result;
}

async function addUsers(db: any, ids: string[]) {
  for (const id of ids) await db.query('insert into auth.users(id) values ($1::uuid)', [id]);
}

/** Provision a partner as the database administrator (owner role). */
async function provision(db: any, userId: string, code: string) {
  return (
    await db.query('select public.provision_growth_partner($1::uuid, $2) as result', [userId, code])
  ).rows[0].result;
}

async function link(db: any, userId: string, code: string) {
  return rpc(db, userId, 'link_my_growth_referral', [code]);
}

async function start(db: any, userId: string) {
  return rpc(db, userId, 'update_my_onboarding_progress', ['start_template']);
}

/** Full onboarding row read as the administrator (RLS bypass, for assertions). */
async function onboardingRow(db: any, userId: string) {
  return (
    await db.query(
      `select user_id, status, growth_partner_id, referral_code, linked_at,
              template_started_at, template_completed_at, created_at, updated_at
       from public.growth_onboarding where user_id = $1::uuid`,
      [userId]
    )
  ).rows[0];
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

// ---------------------------------------------------------------------------
// Verified completion — the happy path and its conditions
// ---------------------------------------------------------------------------

test('verified completion succeeds for a linked user with a finished website, backfilling the start', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);
    await link(db, OWNER, CODE);

    // No handoff/start happened (direct Template App use) — completion still
    // verifies against the finished website and backfills the start instant.
    const done = await rpc(db, OWNER, 'complete_template_onboarding');
    assert.equal(done.status, 'template_completed');
    assert.equal(done.completed, true);
    assert.equal(done.linked, true);
    assert.equal(done.growth_partner_id, PARTNER);
    assert.ok(done.template_started_at);
    assert.ok(done.template_completed_at);
    assert.ok(Date.parse(done.template_completed_at) >= Date.parse(done.template_started_at));

    const row = await onboardingRow(db, OWNER);
    assert.equal(row.status, 'template_completed');
    assert.ok(row.template_started_at);
    assert.ok(row.template_completed_at);
  } finally {
    await db.close();
  }
});

test('the legacy stepper still requires a start even with a finished website; the completion event does not', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);
    await link(db, OTHER_OWNER, CODE);

    // OTHER_OWNER's website (OTHER_SALON + OTHER_SERVICE) is finished, but
    // the stepper contract — start before complete — is preserved.
    await assert.rejects(
      rpc(db, OTHER_OWNER, 'update_my_onboarding_progress', ['complete_template']),
      /Start the template/
    );
    // The completion event has no step to skip: it verifies the website.
    const done = await rpc(db, OTHER_OWNER, 'complete_template_onboarding');
    assert.equal(done.status, 'template_completed');
    assert.equal(done.completed, true);
  } finally {
    await db.close();
  }
});

test('an unfinished website rejects with the safe message and changes nothing (no cross-user leakage)', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);
    await link(db, CUSTOMER_USER, CODE);
    await start(db, CUSTOMER_USER);
    const before = await onboardingRow(db, CUSTOMER_USER);

    // CUSTOMER_USER has no organization membership — while OWNER's finished
    // website sits in the SAME database. It must not leak across users.
    await assert.rejects(rpc(db, CUSTOMER_USER, 'complete_template_onboarding'), /website setup is not complete yet/);
    await assert.rejects(
      rpc(db, CUSTOMER_USER, 'update_my_onboarding_progress', ['complete_template']),
      /website setup is not complete yet/
    );
    assert.deepEqual(await onboardingRow(db, CUSTOMER_USER), before);
    assert.equal((await rpc(db, CUSTOMER_USER, 'get_my_onboarding_status')).status, 'template_started');
  } finally {
    await db.close();
  }
});

test('inactive membership does not verify; restoring it completes', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);
    await link(db, OWNER, CODE);
    await start(db, OWNER);

    await db.query(
      `update public.organization_members set status = 'suspended'
       where organization_id = $1::uuid and user_id = $2::uuid`,
      [ORG, OWNER]
    );
    await assert.rejects(rpc(db, OWNER, 'complete_template_onboarding'), /website setup is not complete yet/);

    await db.query(
      `update public.organization_members set status = 'active'
       where organization_id = $1::uuid and user_id = $2::uuid`,
      [ORG, OWNER]
    );
    assert.equal((await rpc(db, OWNER, 'complete_template_onboarding')).status, 'template_completed');
  } finally {
    await db.close();
  }
});

test('a non-builder role does not verify; restoring owner completes', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);
    await link(db, OWNER, CODE);
    await start(db, OWNER);

    await db.query(
      `update public.organization_members set role = 'receptionist'
       where organization_id = $1::uuid and user_id = $2::uuid`,
      [ORG, OWNER]
    );
    await assert.rejects(rpc(db, OWNER, 'complete_template_onboarding'), /website setup is not complete yet/);

    await db.query(
      `update public.organization_members set role = 'owner'
       where organization_id = $1::uuid and user_id = $2::uuid`,
      [ORG, OWNER]
    );
    assert.equal((await rpc(db, OWNER, 'complete_template_onboarding')).status, 'template_completed');
  } finally {
    await db.close();
  }
});

test('a salon without slug or name does not verify; restoring both completes', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);
    await link(db, OWNER, CODE);
    await start(db, OWNER);

    await db.query('update public.salons set slug = null where id = $1::uuid', [SALON]);
    await assert.rejects(rpc(db, OWNER, 'complete_template_onboarding'), /website setup is not complete yet/);

    await db.query('update public.salons set slug = $2, name = null where id = $1::uuid', [SALON, 'uma-salon']);
    await assert.rejects(rpc(db, OWNER, 'complete_template_onboarding'), /website setup is not complete yet/);

    await db.query('update public.salons set name = $2 where id = $1::uuid', [SALON, 'Uma Salon']);
    assert.equal((await rpc(db, OWNER, 'complete_template_onboarding')).status, 'template_completed');
  } finally {
    await db.close();
  }
});

test('a website without an active service does not verify (NULL counts as active, mirroring the app)', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);
    await link(db, OWNER, CODE);
    await start(db, OWNER);
    await link(db, OTHER_OWNER, CODE);
    await start(db, OTHER_OWNER);

    await db.query('update public.services set is_active = false where id = $1::uuid', [SERVICE]);
    await assert.rejects(rpc(db, OWNER, 'complete_template_onboarding'), /website setup is not complete yet/);
    await db.query('update public.services set is_active = true where id = $1::uuid', [SERVICE]);
    assert.equal((await rpc(db, OWNER, 'complete_template_onboarding')).status, 'template_completed');

    // NULL is_active reads as active in the Template App (`row.is_active ??
    // true` in src/App.tsx) — the check mirrors that instead of failing users
    // over legacy nulls.
    await db.query('update public.services set is_active = null where id = $1::uuid', [OTHER_SERVICE]);
    assert.equal((await rpc(db, OTHER_OWNER, 'complete_template_onboarding')).status, 'template_completed');
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Idempotency, ownership, isolation, partner visibility
// ---------------------------------------------------------------------------

test('completion is idempotent: repeats keep every timestamp and never duplicate', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);
    await link(db, OWNER, CODE);
    await start(db, OWNER);

    await rpc(db, OWNER, 'complete_template_onboarding');
    const first = await onboardingRow(db, OWNER);

    // Save retries re-fire the event — the row must be byte-identical,
    // including updated_at (no rewrite, no new timestamp).
    const repeated = await rpc(db, OWNER, 'complete_template_onboarding');
    assert.equal(Date.parse(repeated.template_completed_at), first.template_completed_at.getTime());
    assert.deepEqual(await onboardingRow(db, OWNER), first);
    await rpc(db, OWNER, 'update_my_onboarding_progress', ['complete_template']);
    assert.deepEqual(await onboardingRow(db, OWNER), first);
    // Terminal state cannot regress through the stepper either.
    await rpc(db, OWNER, 'update_my_onboarding_progress', ['start_template']);
    assert.deepEqual(await onboardingRow(db, OWNER), first);

    assert.equal(
      (await db.query('select count(*)::int as n from public.growth_onboarding where user_id = $1::uuid', [OWNER])).rows[0].n,
      1
    );
  } finally {
    await db.close();
  }
});

test('completion never touches referral ownership', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);
    const linked = await link(db, OWNER, CODE);
    await start(db, OWNER);

    const done = await rpc(db, OWNER, 'complete_template_onboarding');
    assert.equal(done.growth_partner_id, PARTNER);
    assert.equal(done.referral_code, CODE);
    assert.equal(done.linked_at, linked.linked_at);
    assert.deepEqual(
      (({ growth_partner_id, referral_code, linked_at }) => ({ growth_partner_id, referral_code, linked_at }))(
        await onboardingRow(db, OWNER)
      ),
      { growth_partner_id: PARTNER, referral_code: CODE, linked_at: new Date(linked.linked_at) }
    );
  } finally {
    await db.close();
  }
});

test('users with no funnel row are a no-op: nothing is created', async () => {
  const db = await setup();
  try {
    const res = await rpc(db, CUSTOMER_USER, 'complete_template_onboarding');
    assert.deepEqual(res, {
      status: 'not_started',
      linked: false,
      growth_partner_id: null,
      referral_code: null,
      linked_at: null,
      template_started_at: null,
      template_completed_at: null,
      completed: false,
    });
    assert.equal(
      (await db.query('select count(*)::int as n from public.growth_onboarding where user_id = $1::uuid', [CUSTOMER_USER])).rows[0].n,
      0
    );
  } finally {
    await db.close();
  }
});

test('anonymous callers are denied and completed rows stay invisible to other users', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);
    await link(db, OWNER, CODE);
    await start(db, OWNER);
    await rpc(db, OWNER, 'complete_template_onboarding');

    await assert.rejects(asUser(db, '', 'select public.complete_template_onboarding()'), /permission denied/);
    assert.equal((await rpc(db, OTHER_OWNER, 'get_my_onboarding_status')).status, 'not_started');
    assert.equal(
      (await asUser(db, OTHER_OWNER, 'select * from public.growth_onboarding')).rows.length,
      0
    );
  } finally {
    await db.close();
  }
});

test('the partner sees the completed referral through the existing shared row — no second customer', async () => {
  const db = await setup();
  try {
    await addUsers(db, [PARTNER, PARTNER_2]);
    await provision(db, PARTNER, CODE);
    await provision(db, PARTNER_2, CODE_2);
    await link(db, OWNER, CODE);
    await start(db, OWNER);
    const done = await rpc(db, OWNER, 'complete_template_onboarding');

    const seen = (
      await asUser(
        db,
        PARTNER,
        'select user_id, status, template_completed_at, growth_partner_id from public.growth_onboarding'
      )
    ).rows;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].user_id, OWNER);
    assert.equal(seen[0].status, 'template_completed');
    assert.equal(seen[0].template_completed_at.getTime(), Date.parse(done.template_completed_at));
    assert.equal(seen[0].growth_partner_id, PARTNER);

    // Another partner sees nothing of this relationship.
    assert.equal((await asUser(db, PARTNER_2, 'select * from public.growth_onboarding')).rows.length, 0);
  } finally {
    await db.close();
  }
});

test('full journey: link → handoff entry → setup → verified completion → relogin recognized, no duplicates', async () => {
  const db = await setup(true);
  try {
    await addUsers(db, [PARTNER]);
    await provision(db, PARTNER, CODE);

    // Referral added (Onboarding App) → secure handoff entry (Template App).
    await link(db, OWNER, CODE);
    const handoff = await rpc(db, OWNER, 'create_template_handoff', ['journey-state']);
    assert.ok(handoff.token);
    const entered = await rpc(db, OWNER, 'exchange_template_handoff', [handoff.token]);
    assert.equal(entered.onboarding_status, 'template_started');
    assert.ok(entered.template_started_at);

    // Website not finished yet (service deactivated) → completion refuses.
    await db.query('update public.services set is_active = false where id = $1::uuid', [SERVICE]);
    await assert.rejects(rpc(db, OWNER, 'complete_template_onboarding'), /website setup is not complete yet/);

    // User finishes setup and saves → verified completion.
    await db.query('update public.services set is_active = true where id = $1::uuid', [SERVICE]);
    const done = await rpc(db, OWNER, 'complete_template_onboarding');
    assert.equal(done.status, 'template_completed');
    assert.ok(Date.parse(done.template_completed_at) >= Date.parse(entered.template_started_at));

    // Relogin: a fresh status read recognizes the completed state.
    assert.deepEqual(await rpc(db, OWNER, 'get_my_onboarding_status'), {
      status: 'template_completed',
      linked: true,
      growth_partner_id: PARTNER,
      referral_code: CODE,
      linked_at: done.linked_at,
      template_started_at: done.template_started_at,
      template_completed_at: done.template_completed_at,
    });

    // Retries change nothing; exactly one funnel row exists.
    assert.deepEqual((await rpc(db, OWNER, 'complete_template_onboarding')).template_completed_at, done.template_completed_at);
    assert.equal(
      (await db.query('select count(*)::int as n from public.growth_onboarding where user_id = $1::uuid', [OWNER])).rows[0].n,
      1
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Migration shape: additive only, least privilege, session-derived caller
// ---------------------------------------------------------------------------

test('the completion migration adds no tables, no seed writes, no secrets, and least-privilege grants', () => {
  assert.doesNotMatch(COMPLETION_MIGRATION, /create table/i);
  // The single INSERT is the pre-existing stepper's idempotent row bootstrap
  // (carried over verbatim) — no seed rows, no log/event writes.
  assert.equal(COMPLETION_MIGRATION.match(/insert into/gi)?.length || 0, 1);
  assert.match(
    COMPLETION_MIGRATION,
    /insert into public\.growth_onboarding as o \(user_id\) values \(actor\)\s+on conflict \(user_id\) do nothing;/
  );
  assert.doesNotMatch(COMPLETION_MIGRATION, /service_role|service-role|secret|password|jwt|apikey|api_key/i);
  assert.match(
    COMPLETION_MIGRATION,
    /revoke all on function public\.complete_template_onboarding\(\) from public, anon;/
  );
  assert.match(
    COMPLETION_MIGRATION,
    /grant execute on function public\.complete_template_onboarding\(\) to authenticated;/
  );
  assert.match(
    COMPLETION_MIGRATION,
    /revoke all on function public\.template_website_is_complete\(uuid\) from public, anon, authenticated;/
  );
  assert.match(
    COMPLETION_MIGRATION,
    /revoke all on function public\.template_completion_has_column\(text, text\) from public, anon, authenticated;/
  );
});

test('the completion RPC takes no user argument and derives the caller from the session', () => {
  assert.match(COMPLETION_MIGRATION, /create or replace function public\.complete_template_onboarding\(\)/);
  const completeFn = COMPLETION_MIGRATION.match(
    /create or replace function public\.complete_template_onboarding\(\)[\s\S]*?\nend;\n\$\$;/
  );
  assert.ok(completeFn, 'complete_template_onboarding body found');
  // p_user_id exists only on the private revoked helper — never on the RPC.
  assert.doesNotMatch(completeFn[0], /p_user_id|p_actor|p_email/);
  assert.match(completeFn[0], /actor uuid := auth\.uid\(\)/);
});

// ---------------------------------------------------------------------------
// Client contract: wrapper, trigger point, safe errors, no localStorage
// ---------------------------------------------------------------------------

test('the completion wrapper calls the verified RPC without user input and maps failures to safe copy', () => {
  const source = readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8');
  assert.match(source, /supabase\.rpc\('complete_template_onboarding'\)/);
  assert.doesNotMatch(source, /rpc\('complete_template_onboarding',/);

  assert.equal(TEMPLATE_COMPLETION_NOT_READY_MESSAGE, 'Your website setup is not complete yet.');
  assert.equal(TEMPLATE_COMPLETION_GENERIC_MESSAGE, 'Could not update completion status. Please try again.');
  assert.equal(
    toCompletionError(new Error('Template completion update failed (22023): Your website setup is not complete yet.')).message,
    TEMPLATE_COMPLETION_NOT_READY_MESSAGE
  );
  assert.equal(toCompletionError(new Error('connection reset by peer')).message, TEMPLATE_COMPLETION_GENERIC_MESSAGE);
  assert.equal(toCompletionError('plain string boom').message, TEMPLATE_COMPLETION_GENERIC_MESSAGE);
  assert.equal(toCompletionError(null).message, TEMPLATE_COMPLETION_GENERIC_MESSAGE);
  assert.equal(isCompletionNotReadyError(new Error('Your website setup is not complete yet.')), true);
  assert.equal(isCompletionNotReadyError(new Error('Could not update completion status. Please try again.')), false);
  assert.equal(isCompletionNotReadyError(null), false);
});

test('completion fires only inside the successful explicit-save branch and never from localStorage', () => {
  const source = readFileSync(new URL('../src/components/WebsiteEditor.tsx', import.meta.url), 'utf8');
  const handleSave = source.match(/const handleSave = async[\s\S]*?\n  \};/);
  assert.ok(handleSave, 'handleSave block found');
  const body = handleSave[0];
  // Existing behavior intact: only an explicit successful save opens the dialog.
  assert.match(body, /if \(await onSave\(\)\)/);
  assert.match(body, /setSavedSiteUrl\(siteUrl\)/);
  // The verified event fires after that success — never before, never on failure.
  assert.ok(body.indexOf('await onSave()') < body.indexOf('recordTemplateCompletion()'));
  assert.match(body, /\.catch\(/);
  assert.match(body, /setCompletionNote\('Your website setup is not complete yet\.'\)/);
  assert.doesNotMatch(stripComments(body), /localStorage|sessionStorage/);

  const growthSource = readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(stripComments(growthSource), /localStorage|sessionStorage/);
  const statusSource = readFileSync(new URL('../src/onboarding/screens/StatusScreen.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(stripComments(statusSource), /localStorage|sessionStorage/);
});

test('the success dialog keeps its save state and shows the note only when the backend reports not-ready', () => {
  const plain = renderToStaticMarkup(
    React.createElement(WebsiteSavedModal, { siteUrl: 'https://example.com', onClose: () => {}, onBackToDashboard: () => {} })
  );
  assert.match(plain, /Website saved successfully!/);
  assert.match(plain, /Preview Live Website/);
  assert.doesNotMatch(plain, /not complete yet/);

  const noted = renderToStaticMarkup(
    React.createElement(WebsiteSavedModal, {
      siteUrl: 'https://example.com',
      onClose: () => {},
      onBackToDashboard: () => {},
      completionNote: 'Your website setup is not complete yet.',
    })
  );
  assert.match(noted, /Website saved successfully!/);
  assert.match(noted, /Your website setup is not complete yet\./);
  assert.match(noted, /role="status"/);
});

test('the status screen shows a completed ready state with a plain Template App link', () => {
  const completed = renderToStaticMarkup(
    React.createElement(StatusScreen, {
      phase: 'completed',
      referralCode: CODE,
      partnerName: 'Partner Greta',
      email: 'owner@example.com',
      completed: true,
    })
  );
  assert.match(completed, new RegExp(STATUS_COMPLETED_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(completed, new RegExp(STATUS_COMPLETED_BODY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(completed, /Open Template App/);
  const link = completed.match(/<a href="([^"]*)"[^>]*>Open Template App<\/a>/);
  assert.ok(link, 'plain anchor to the Template App found');
  assert.doesNotMatch(link[1], /token|state|\?/);
  // Ready state only: no referral repeat, no handoff, no signup.
  assert.doesNotMatch(completed, /Continue to Template App/);
  assert.doesNotMatch(completed, /Preparing secure handoff/);
  assert.doesNotMatch(completed, /referral code/i);

  const verified = renderToStaticMarkup(React.createElement(StatusScreen, { phase: 'referral_added' }));
  assert.match(verified, new RegExp(STATUS_VERIFIED_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(verified, /Open Template App/);
});

test('completed users always resolve to the status screen — never referral, login or signup again', () => {
  assert.equal(phaseFromOnboardingState({ status: 'template_completed', linked: true }), 'completed');
  for (const requested of ['login', 'signup', 'forgot-password', 'referral', 'status'] as const) {
    assert.equal(resolveOnboardingRoute({ hasSession: true, phase: 'completed', requested }), 'status');
  }
  const source = readFileSync(new URL('../src/onboarding/OnboardingApp.tsx', import.meta.url), 'utf8');
  assert.match(source, /completed=\{phase === 'completed'\}/);
  assert.match(
    source,
    /onContinueToTemplateApp=\{phase === 'completed' \? undefined : handleContinueToTemplateApp\}/
  );
});
