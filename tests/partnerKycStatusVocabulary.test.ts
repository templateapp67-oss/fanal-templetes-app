// ============================================================================
// Growth Partner application — the KYC state vocabulary mismatch.
//
// The reported bug: submitting an application stored nothing and the browser
// showed only "Check your application details and try again."
//
//   • The write path stores the KYC state as 'submitted' (canonical).
//   • A project whose `growth_partner_applications.kyc_status` still carries the
//     OLD check — ('pending','approved','rejected') — refuses that row with
//     23514 (check_violation), and the UI had no field to blame, so it fell back
//     to its generic sentence.
//
// This file proves both halves of the fix:
//
//   A. the migration. It reproduces the legacy constraint on a real Postgres
//      (PGlite), shows the refusal, then shows 20261031000000 reconciling it:
//      the same submission is stored as 'submitted', a legacy 'pending' row is
//      normalized, and re-running the migration changes nothing.
//   B. the client. It survives a project that has NOT applied the migration yet
//      (retry with the legacy value instead of failing), and when even that is
//      refused the user gets the actionable schema message — never the generic
//      "check your application details" sentence.
// ============================================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createLocalDatabase } from '../server/localSupabase';
import { PARTNER_APPLICATION_ERROR_MESSAGES, PartnerApplicationError } from '../src/lib/partnerApplicationErrors';
import { submitGrowthPartnerApplication, type GrowthPartnerAuthClient } from '../src/lib/growthPartnerLogin';

const APPLICANT = 'd0000000-0000-4000-8000-0000000000b1';
const VOCABULARY_MIGRATION = '20261031000000_partner_kyc_status_vocabulary.sql';

const LEGACY_CHECK = "check (kyc_status in ('pending','approved','rejected'))";
const CANONICAL_CHECK =
  "check (kyc_status in ('not_submitted','submitted','under_review','approved','rejected'))";

function migrationSql(file: string): string {
  return readFileSync(path.join(process.cwd(), 'supabase', 'migrations', file), 'utf8');
}

/**
 * Apply a migration file. `ownerQuery` uses a prepared statement (one command
 * per call), and a migration file is many — so multi-statement SQL goes through
 * the raw PGlite handle the local gateway exposes for exactly this.
 */
async function exec(local: { db: any }, sql: string): Promise<void> {
  await local.db.exec(sql);
}

async function setup() {
  const local = await createLocalDatabase();
  await local.ownerQuery(
    `insert into auth.users (id, email, encrypted_password)
     values ($1, 'applicant@example.com', 'x')
     on conflict (id) do nothing`,
    [APPLICANT]
  );
  await local.ownerQuery(
    `insert into public.profiles (id, full_name) values ($1, 'Applicant')
     on conflict (id) do nothing`,
    [APPLICANT]
  );
  return local;
}

/** Put the table into the state the reported project was in. */
async function installLegacyVocabulary(local: Awaited<ReturnType<typeof setup>>): Promise<void> {
  await local.ownerQuery(
    `alter table public.growth_partner_applications
       drop constraint if exists growth_partner_applications_kyc_status_check,
     add constraint growth_partner_applications_kyc_status_check ${LEGACY_CHECK}`
  );
}

async function submit(
  local: Awaited<ReturnType<typeof setup>>,
  args: { name: string; phone?: string; type: string; ref: string }
): Promise<{ ok: true; row: any } | { ok: false; code: string; message: string }> {
  return local.asRequest({ sub: APPLICANT, isAdmin: false }, async (db) => {
    try {
      const { rows } = await db.query(
        'select public.submit_growth_partner_application($1,$2,$3,$4) as result',
        [args.name, args.phone ?? '9876543210', args.type, args.ref]
      );
      return { ok: true as const, row: rows[0].result };
    } catch (error: any) {
      return { ok: false as const, code: String(error?.code ?? ''), message: String(error?.message ?? '') };
    }
  });
}

const VALID = { name: 'Asha Sharma', phone: '9876543210', type: 'aadhaar', ref: '123456789012' };

// ---------------------------------------------------------------------------
// A. The database
// ---------------------------------------------------------------------------

test('A1. the legacy vocabulary refuses the canonical write — the reported bug', async () => {
  const local = await setup();
  try {
    await installLegacyVocabulary(local);

    const refused = await submit(local, VALID);
    assert.equal(refused.ok, false, 'the old CHECK must reproduce the failure');
    if (refused.ok) return;
    assert.equal(refused.code, '23514', 'check_violation is what PostgREST reports and what broke the UI');
    assert.match(refused.message, /kyc_status/i, 'the refusal names the column that has to be reconciled');

    const count = await local.ownerQuery('select count(*)::int as n from public.growth_partner_applications');
    assert.equal(count.rows[0].n, 0, 'nothing was stored, which is why the applicant saw an empty result');
  } finally {
    await local.close();
  }
});

test('A2. the vocabulary migration makes the same submission succeed', async () => {
  const local = await setup();
  try {
    await installLegacyVocabulary(local);
    await exec(local, migrationSql(VOCABULARY_MIGRATION));

    const submitted = await submit(local, VALID);
    assert.equal(submitted.ok, true, `the application must be stored: ${JSON.stringify(submitted)}`);
    if (!submitted.ok) return;
    // The subject here is the KYC vocabulary, not the enrollment policy:
    // `20260930044315_growth_partner_instant_enrollment.sql` (main) approves a
    // submitted application on the spot, so the workflow status is whatever
    // that trigger decides — the row must exist either way.
    assert.ok(
      ['pending', 'approved'].includes(submitted.row.status),
      `the application was stored with a workflow status: ${submitted.row.status}`
    );
    assert.equal(submitted.row.kyc_status, 'submitted', 'the canonical state is stored after reconciling');

    // One constraint, and it is the reconciled one.
    const constraints = await local.ownerQuery(
      `select conname, pg_get_constraintdef(oid) as definition
         from pg_constraint
        where conrelid = 'public.growth_partner_applications'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) ~ '\\mkyc_status\\M'`
    );
    assert.equal(constraints.rows.length, 1, 'exactly one kyc_status check survives');
    assert.match(constraints.rows[0].definition, /pending/, 'the legacy alias is still accepted');
    assert.match(constraints.rows[0].definition, /submitted/, 'the canonical state is accepted');
  } finally {
    await local.close();
  }
});

test('A3. a stored legacy "pending" KYC row is normalized, not left behind', async () => {
  const local = await setup();
  try {
    await installLegacyVocabulary(local);
    // A row written by the old build: 'pending' KYC, review not finished.
    await local.ownerQuery(
      `insert into public.growth_partner_applications
         (user_id, full_name, status, kyc_status, kyc_document_type, kyc_document_reference)
       values ($1, 'Asha Sharma', 'pending', 'pending', 'aadhaar', '123456789012')`,
      [APPLICANT]
    );

    await exec(local, migrationSql(VOCABULARY_MIGRATION));

    const row = await local.ownerQuery(
      'select kyc_status from public.growth_partner_applications where user_id = $1',
      [APPLICANT]
    );
    assert.equal(row.rows[0].kyc_status, 'submitted', 'KYC received + awaiting review is "submitted"');
  } finally {
    await local.close();
  }
});

test('A4. re-running the migration is a no-op, and the canonical vocabulary stays installed', async () => {
  const local = await setup();
  try {
    await exec(local, migrationSql(VOCABULARY_MIGRATION));
    await exec(local, migrationSql(VOCABULARY_MIGRATION));

    const constraints = await local.ownerQuery(
      `select count(*)::int as n
         from pg_constraint
        where conrelid = 'public.growth_partner_applications'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) ~ '\\mkyc_status\\M'`
    );
    assert.equal(constraints.rows[0].n, 1, 'a second run must not stack duplicate constraints');

    const submitted = await submit(local, VALID);
    assert.equal(submitted.ok, true, 'the canonical write still succeeds');
  } finally {
    await local.close();
  }
});

test('A5. the migration is installable on a project that only has the canonical check', async () => {
  const local = await setup();
  try {
    // The state 20261030 leaves behind: a check without the legacy alias.
    await local.ownerQuery(
      `alter table public.growth_partner_applications
         drop constraint if exists growth_partner_applications_kyc_status_check,
       add constraint growth_partner_applications_kyc_status_check ${CANONICAL_CHECK}`
    );
    await exec(local, migrationSql(VOCABULARY_MIGRATION));

    const submitted = await submit(local, VALID);
    assert.equal(submitted.ok, true, 'submission works on both starting states');
  } finally {
    await local.close();
  }
});

test('A6. the normalize trigger can resolve the function it calls, and both forms agree', async () => {
  const local = await setup();
  try {
    // The hardening migration's trigger calls the TWO-argument normalizer. Before
    // 20261031000001 that function did not exist, so every insert failed with
    // 42883 — nothing could be stored at all.
    const forms = await local.ownerQuery(
      `select public.normalize_partner_kyc_reference('1234-5678-9012') as one_arg,
              public.normalize_partner_kyc_reference('aadhaar', ' 1234 5678 9012 ') as two_arg`
    );
    assert.equal(forms.rows[0].two_arg, '123456789012', 'the trigger’s signature resolves');
    assert.equal(forms.rows[0].one_arg, forms.rows[0].two_arg, 'both forms agree on one canonical value');

    // And a plain insert (which fires the trigger) is really stored, normalized.
    await local.ownerQuery(
      `insert into public.growth_partner_applications
         (user_id, full_name, status, kyc_status, kyc_document_type, kyc_document_reference)
       values ($1, '  Asha   Sharma ', 'pending', 'submitted', 'aadhaar', '1234-5678-9012')`,
      [APPLICANT]
    );
    const row = await local.ownerQuery(
      `select full_name, kyc_document_reference from public.growth_partner_applications
        where user_id = $1`,
      [APPLICANT]
    );
    assert.equal(row.rows[0].full_name, 'Asha Sharma');
    assert.equal(row.rows[0].kyc_document_reference, '123456789012');
  } finally {
    await local.close();
  }
});

// ---------------------------------------------------------------------------
// B. The client (a project that has not applied the migration yet)
// ---------------------------------------------------------------------------

const INPUT = {
  fullName: 'Asha Sharma',
  phone: '9876543210',
  kycDocumentType: 'aadhaar',
  kycDocumentReference: '123456789012',
};

/** The shape PostgREST returns for the stale CHECK. */
const LEGACY_REFUSAL = {
  code: '23514',
  message:
    'new row for relation "growth_partner_applications" violates check constraint "growth_partner_applications_kyc_status_check"',
  details: 'Failing row contains (…, pending, submitted, …).',
};

function fakeClient(options: {
  rpcError?: unknown;
  insert: (payload: Record<string, unknown>) => { data?: unknown; error?: unknown };
}): GrowthPartnerAuthClient & { rpcCalls: number; inserts: Array<Record<string, unknown>> } {
  const state = {
    rpcCalls: 0,
    inserts: [] as Array<Record<string, unknown>>,
  };
  return {
    get rpcCalls() {
      return state.rpcCalls;
    },
    get inserts() {
      return state.inserts;
    },
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }),
    },
    rpc: async () => {
      state.rpcCalls += 1;
      return options.rpcError ? { data: null, error: options.rpcError } : { data: null, error: null };
    },
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        state.inserts.push(payload);
        const outcome = options.insert(payload);
        return {
          select: () => ({
            single: async () => outcome,
          }),
        };
      },
    }),
  } as unknown as GrowthPartnerAuthClient & { rpcCalls: number; inserts: Array<Record<string, unknown>> };
}

test('B1. a stale CHECK no longer blocks the write — the client retries with the legacy value', async () => {
  const client = fakeClient({
    rpcError: LEGACY_REFUSAL,
    insert: (payload) =>
      payload.kyc_status === 'submitted'
        ? { error: LEGACY_REFUSAL }
        : { data: { id: 'app-1', status: 'pending', kyc_status: 'pending', created_at: '2026-09-30T00:00:00Z' } },
  });

  const result = await submitGrowthPartnerApplication(client, INPUT);
  assert.equal(result.status, 'pending');
  assert.equal(client.inserts.length, 2, 'one canonical attempt, then one legacy-compatible retry');
  assert.equal(client.inserts[0].kyc_status, 'submitted');
  assert.equal(client.inserts[1].kyc_status, 'pending', 'the value the old constraint accepts');
  // The retry never carries an identity the caller could choose.
  for (const payload of client.inserts) {
    assert.equal(payload.user_id, 'user-1', 'the row stays owned by the session user');
    assert.equal(payload.status, 'pending');
  }
});

test('B2. when even the legacy write is refused, the copy is the schema fix — not "check your details"', async () => {
  const client = fakeClient({
    rpcError: LEGACY_REFUSAL,
    insert: () => ({ error: LEGACY_REFUSAL }),
  });

  await assert.rejects(submitGrowthPartnerApplication(client, INPUT), (error: unknown) => {
    assert.ok(error instanceof PartnerApplicationError);
    assert.equal(error.kind, 'schema', 'nothing about the form is wrong: retrying it cannot help');
    assert.equal(error.message, PARTNER_APPLICATION_ERROR_MESSAGES.kycStateSchema);
    assert.match(error.message, /20261031000000_partner_kyc_status_vocabulary\.sql/);
    assert.doesNotMatch(
      error.message,
      /Check your application details and try again/i,
      'the vague sentence was the reported symptom'
    );
    assert.equal(error.field, undefined, 'no field is marked: the applicant typed nothing wrong');
    return true;
  });
});

test('B3. an unrelated check violation is still reported as the field it belongs to', async () => {
  const client = fakeClient({
    rpcError: {
      code: '23514',
      message:
        'new row for relation "growth_partner_applications" violates check constraint "growth_partner_applications_kyc_reference_check"',
    },
    insert: () => ({
      error: {
        code: '23514',
        message:
          'new row for relation "growth_partner_applications" violates check constraint "growth_partner_applications_kyc_reference_check"',
      },
    }),
  });

  await assert.rejects(submitGrowthPartnerApplication(client, INPUT), (error: unknown) => {
    assert.ok(error instanceof PartnerApplicationError);
    assert.notEqual(error.kind, 'schema', 'an Aadhaar/PAN refusal is the applicant’s input, not the schema');
    assert.notEqual(error.message, PARTNER_APPLICATION_ERROR_MESSAGES.kycStateSchema);
    assert.equal(error.field, 'kycDocumentReference');
    return true;
  });
});
