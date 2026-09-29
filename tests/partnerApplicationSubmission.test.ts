// ============================================================================
// Growth Partner application — the submission path end to end.
//
// Two halves, both about the reported "Application failed. Please try again.":
//
//   A. The database (real migrations on PGlite): formats are enforced, a
//      duplicate application and a reused KYC number are refused with 23505
//      (the SQLSTATE PostgREST surfaces as HTTP 409), a rejected applicant may
//      reapply, and RLS keeps every account inside its own row.
//   B. The client submission layer: every failure is classified into actionable
//      copy, the session is checked before the write, a duplicate is refused
//      before the request, and no identity is ever sent.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalDatabase } from '../server/localSupabase';
import {
  PARTNER_APPLICATION_ERROR_MESSAGES,
  PartnerApplicationError,
  partnerApplicationErrorMessage,
  toPartnerApplicationError,
} from '../src/lib/partnerApplicationErrors';
import { submitGrowthPartnerApplication, type GrowthPartnerAuthClient } from '../src/lib/growthPartnerLogin';

const APPLICANT = 'c0000000-0000-4000-8000-0000000000a1';
const OTHER = 'c0000000-0000-4000-8000-0000000000a2';

// ---------------------------------------------------------------------------
// A. The database
// ---------------------------------------------------------------------------

async function setup() {
  const local = await createLocalDatabase();
  await local.ownerQuery(
    `insert into auth.users (id, email, encrypted_password)
     values ($1, 'applicant@example.com', 'x'), ($2, 'other@example.com', 'x')
     on conflict (id) do nothing`,
    [APPLICANT, OTHER]
  );
  await local.ownerQuery(
    `insert into public.profiles (id, full_name) values ($1, 'Applicant'), ($2, 'Other')
     on conflict (id) do nothing`,
    [APPLICANT, OTHER]
  );
  return local;
}

async function submit(
  local: Awaited<ReturnType<typeof setup>>,
  sub: string | null,
  args: { name: string; phone?: string | null; type: string; ref: string }
): Promise<{ ok: true; row: any } | { ok: false; code: string; message: string }> {
  return local.asRequest({ sub, isAdmin: false }, async (db) => {
    try {
      const { rows } = await db.query('select public.submit_growth_partner_application($1,$2,$3,$4) as result', [
        args.name,
        args.phone ?? null,
        args.type,
        args.ref,
      ]);
      return { ok: true as const, row: rows[0].result };
    } catch (error: any) {
      return { ok: false as const, code: String(error?.code ?? ''), message: String(error?.message ?? '') };
    }
  });
}

test('A1. a valid application is stored as pending, normalized, and owned by the caller', async () => {
  const local = await setup();
  try {
    const submitted = await submit(local, APPLICANT, {
      name: '  Asha   Sharma ',
      phone: '+91 98765 43210',
      type: ' aadhaar ',
      ref: '1234-5678-9012',
    });
    assert.equal(submitted.ok, true, JSON.stringify(submitted));
    if (!submitted.ok) return;
    assert.equal(submitted.row.status, 'pending');
    assert.equal(submitted.row.kyc_status, 'submitted');
    assert.ok(submitted.row.id, 'the id the admin review queue needs');

    const stored = await local.ownerQuery(
      'select user_id, full_name, phone, kyc_document_type, kyc_document_reference from public.growth_partner_applications where user_id = $1',
      [APPLICANT]
    );
    assert.equal(stored.rows[0].user_id, APPLICANT, 'the row is owned by auth.uid()');
    assert.equal(stored.rows[0].full_name, 'Asha Sharma', 'whitespace collapsed');
    assert.equal(stored.rows[0].phone, '9876543210', 'phone normalized to 10 digits');
    assert.equal(stored.rows[0].kyc_document_type, 'aadhaar', 'document type normalized');
    assert.equal(stored.rows[0].kyc_document_reference, '123456789012', 'separators removed');
  } finally {
    await local.close();
  }
});

test('A2. formats are enforced server side — the client rules are not the only defence', async () => {
  const local = await setup();
  try {
    const cases: Array<[string, { name: string; phone?: string | null; type: string; ref: string }, string]> = [
      ['11-digit Aadhaar', { name: 'Asha Sharma', phone: '9876543210', type: 'aadhaar', ref: '12345678901' }, 'Invalid Aadhaar number'],
      ['13-digit Aadhaar', { name: 'Asha Sharma', phone: '9876543210', type: 'aadhaar', ref: '1234567890123' }, 'Invalid Aadhaar number'],
      ['malformed PAN', { name: 'Asha Sharma', phone: '9876543210', type: 'pan', ref: 'PAN123456' }, 'Invalid PAN'],
      ['5-digit phone', { name: 'Asha Sharma', phone: '91234', type: 'pan', ref: 'ABCDE1234F' }, '10-digit mobile number'],
      ['unknown document type', { name: 'Asha Sharma', phone: '9876543210', type: 'selfie', ref: 'ABCDE1234F' }, 'valid KYC document type'],
      ['blank reference', { name: 'Asha Sharma', phone: '9876543210', type: 'pan', ref: '   ' }, 'KYC document reference is required'],
      ['1-character name', { name: 'A', phone: '9876543210', type: 'pan', ref: 'ABCDE1234F' }, 'full name'],
    ];
    for (const [label, args, expected] of cases) {
      const result = await submit(local, APPLICANT, args);
      assert.equal(result.ok, false, `${label} must be refused`);
      if (result.ok) continue;
      assert.equal(result.code, '22023', `${label} must be a validation error, got ${result.code}`);
      assert.match(result.message, new RegExp(expected), `${label}: ${result.message}`);
    }
    // Nothing was written by any of the refusals.
    const count = await local.ownerQuery('select count(*)::int as n from public.growth_partner_applications');
    assert.equal(count.rows[0].n, 0, 'a refused application must not leave a row behind');
  } finally {
    await local.close();
  }
});

test('A3. a second submission by the same account is a 409-shaped duplicate, not a silent overwrite', async () => {
  const local = await setup();
  try {
    const first = await submit(local, APPLICANT, { name: 'Asha Sharma', phone: '9876543210', type: 'pan', ref: 'ABCDE1234F' });
    assert.equal(first.ok, true);

    const second = await submit(local, APPLICANT, { name: 'Asha Sharma', phone: '9876543210', type: 'pan', ref: 'ABCDE1234F' });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, '23505', 'unique_violation → HTTP 409 in PostgREST');
    assert.match(second.message, /Application already submitted/);

    // Only one row exists: the second call did not append or rewrite history.
    const count = await local.ownerQuery(
      'select count(*)::int as n from public.growth_partner_applications where user_id = $1',
      [APPLICANT]
    );
    assert.equal(count.rows[0].n, 1);

    // …and the UI copy for that SQLSTATE is the "already submitted" sentence.
    assert.equal(
      partnerApplicationErrorMessage({ code: '23505', message: 'Application already submitted' }),
      'You have already submitted an application.'
    );
  } finally {
    await local.close();
  }
});

test('A4. the same KYC document cannot be registered by two different accounts', async () => {
  const local = await setup();
  try {
    const first = await submit(local, APPLICANT, { name: 'Asha Sharma', phone: '9876543210', type: 'aadhaar', ref: '123456789012' });
    assert.equal(first.ok, true, JSON.stringify(first));

    // A different account reusing the SAME Aadhaar number (any spelling) is
    // refused before a row is written.
    const reused = await submit(local, OTHER, { name: 'Vikram Rao', phone: '9123456780', type: 'aadhaar', ref: '1234 5678 9012' });
    assert.equal(reused.ok, false, 'a reused Aadhaar number must be refused');
    if (reused.ok) return;
    assert.equal(reused.code, '23505');
    assert.match(reused.message, /KYC document already used/);

    // The refusal is not a dead end: the same account is free to apply with its
    // own document, in a different namespace (PAN), immediately afterwards.
    const ownPan = await submit(local, OTHER, { name: 'Vikram Rao', phone: '9123456780', type: 'pan', ref: 'ABCDE1234F' });
    assert.equal(ownPan.ok, true, JSON.stringify(ownPan));

    const rows = await local.ownerQuery(
      'select user_id, kyc_document_type from public.growth_partner_applications order by user_id'
    );
    assert.equal(rows.rows.length, 2, 'one application per account, each with its own document');
  } finally {
    await local.close();
  }
});

test('A5. a rejected applicant may reapply; an approved one is not reopened', async () => {
  const local = await setup();
  try {
    await submit(local, APPLICANT, { name: 'Asha Sharma', phone: '9876543210', type: 'pan', ref: 'ABCDE1234F' });
    await local.ownerQuery("update public.growth_partner_applications set status = 'rejected', kyc_status = 'rejected' where user_id = $1", [APPLICANT]);

    const reapplied = await submit(local, APPLICANT, { name: 'Asha Sharma', phone: '9876543210', type: 'aadhaar', ref: '123456789012' });
    assert.equal(reapplied.ok, true, 'a rejected applicant must be able to apply again');
    if (!reapplied.ok) return;
    assert.equal(reapplied.row.status, 'pending');
    assert.equal(reapplied.row.kyc_status, 'submitted');

    // Approved → the application is final; only an administrator reviews it.
    await local.ownerQuery("update public.growth_partner_applications set status = 'approved', kyc_status = 'approved' where user_id = $1", [APPLICANT]);
    const afterApproval = await submit(local, APPLICANT, { name: 'Asha Sharma', phone: '9876543210', type: 'aadhaar', ref: '123456789012' });
    assert.equal(afterApproval.ok, false);
    if (afterApproval.ok) return;
    assert.equal(afterApproval.code, '23505');
  } finally {
    await local.close();
  }
});

test('A6. RLS: the caller sees and inserts only their own application', async () => {
  const local = await setup();
  try {
    await submit(local, APPLICANT, { name: 'Asha Sharma', phone: '9876543210', type: 'pan', ref: 'ABCDE1234F' });

    const own = await local.asRequest({ sub: APPLICANT, isAdmin: false }, async (db) =>
      (await db.query('select id, user_id, full_name, phone, kyc_type, kyc_number, status, created_at from public.partner_applications')) as any
    );
    assert.equal(own.rows.length, 1);
    assert.equal(own.rows[0].user_id, APPLICANT);
    assert.equal(own.rows[0].kyc_type, 'pan');
    assert.equal(own.rows[0].kyc_number, 'ABCDE1234F');

    const other = await local.asRequest({ sub: OTHER, isAdmin: false }, async (db) =>
      (await db.query('select id from public.partner_applications')) as any
    );
    assert.equal(other.rows.length, 0, 'another account sees no application');

    // The product-facing view is insertable, but only for the caller's own id
    // and only as pending — the RLS policy decides, not the client.
    const inserted = await local
      .asRequest({ sub: OTHER, isAdmin: false }, (db) =>
        db.query(
          `insert into public.partner_applications (user_id, full_name, phone, kyc_type, kyc_number, status)
           values ($1, 'Vikram Rao', '9123456780', 'passport', 'A1234567', 'pending') returning user_id`,
          [OTHER]
        )
      )
      .then(() => 'inserted')
      .catch((error: any) => `${error.code}`);
    assert.equal(inserted, 'inserted');

    const forged = await local
      .asRequest({ sub: OTHER, isAdmin: false }, (db) =>
        db.query(
          `insert into public.partner_applications (user_id, full_name, phone, kyc_type, kyc_number, status)
           values ($1, 'Impostor', '9123456780', 'passport', 'B1234567', 'pending')`,
          [APPLICANT]
        )
      )
      .then(() => 'inserted')
      .catch((error: any) => String(error.code));
    assert.equal(forged, '42501', 'an application for another account is refused by RLS');

    const selfApproved = await local
      .asRequest({ sub: OTHER, isAdmin: false }, (db) =>
        db.query(
          `insert into public.partner_applications (user_id, full_name, phone, kyc_type, kyc_number, status)
           values ($1, 'Vikram Rao', '9123456780', 'passport', 'C1234567', 'approved')`,
          [OTHER]
        )
      )
      .then(() => 'inserted')
      .catch((error: any) => String(error.code));
    assert.equal(selfApproved, '42501', 'an applicant cannot insert an approved application');

    // Updates are not granted at all: approval is the admin-only RPC.
    const updated = await local
      .asRequest({ sub: APPLICANT, isAdmin: false }, (db) =>
        db.query("update public.partner_applications set status = 'approved' where user_id = $1", [APPLICANT])
      )
      .then(() => 'updated')
      .catch((error: any) => String(error.code));
    assert.equal(updated, '42501');
  } finally {
    await local.close();
  }
});

test('A7. the migration is idempotent', async () => {
  const local = await setup();
  try {
    const { readFileSync } = await import('node:fs');
    await local.ownerQuery('select 1');
    await local.db.exec(
      readFileSync('supabase/migrations/20261030000000_partner_applications_hardening.sql', 'utf8')
    );
    const submitted = await submit(local, APPLICANT, { name: 'Asha Sharma', phone: '9876543210', type: 'pan', ref: 'ABCDE1234F' });
    assert.equal(submitted.ok, true, 'the RPC still works after a second apply');
  } finally {
    await local.close();
  }
});

// ---------------------------------------------------------------------------
// B. The client submission layer
// ---------------------------------------------------------------------------

function fakeClient(overrides: {
  rpc?: (name: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  session?: { id: string } | null;
  sessionThrows?: boolean;
  application?: { status?: string | null } | null;
} = {}): GrowthPartnerAuthClient & { calls: Array<{ name: string; args?: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => {
        if (overrides.sessionThrows) throw new TypeError('Failed to fetch');
        const id = overrides.session === undefined ? 'user-1' : overrides.session?.id;
        return { data: { session: id ? { user: { id } } : null }, error: null };
      },
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return overrides.rpc
        ? overrides.rpc(name, args)
        : { data: { id: 'app-1', status: 'pending', kyc_status: 'submitted', created_at: '2026-09-29T00:00:00Z' }, error: null };
    },
    ...(overrides.application !== undefined
      ? { fetchApplicationRow: async () => overrides.application }
      : {}),
  } as GrowthPartnerAuthClient & { calls: Array<{ name: string; args?: Record<string, unknown> }> };
}

const INPUT = {
  fullName: 'Asha Sharma',
  phone: '9876543210',
  kycDocumentType: 'aadhaar',
  kycDocumentReference: '123456789012',
};

test('B1. a valid submission sends sanitized values only — no identity, no status', async () => {
  const client = fakeClient();
  const result = await submitGrowthPartnerApplication(client, {
    fullName: '  Asha  Sharma ',
    phone: '+91 98765 43210',
    kycDocumentType: ' AADHAAR ',
    kycDocumentReference: '1234-5678-9012',
  });
  assert.deepEqual(client.calls, [
    {
      name: 'submit_growth_partner_application',
      args: {
        p_full_name: 'Asha Sharma',
        p_phone: '9876543210',
        p_kyc_document_type: 'aadhaar',
        p_kyc_document_reference: '123456789012',
      },
    },
  ]);
  const payload = client.calls[0].args as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(payload).filter((key) => /user_id|partner_id|status/i.test(key)),
    [],
    'the payload must not carry an identity or a status'
  );
  assert.equal(result.status, 'pending');
  assert.equal(result.kycStatus, 'submitted');
  assert.equal(result.id, 'app-1');
});

test('B2. an invalid Aadhaar number is refused before the request leaves the browser', async () => {
  const client = fakeClient();
  await assert.rejects(
    submitGrowthPartnerApplication(client, { ...INPUT, kycDocumentReference: '12345678901' }),
    (error: unknown) => {
      assert.ok(error instanceof PartnerApplicationError);
      assert.equal(error.kind, 'validation');
      assert.equal(error.field, 'kycDocumentReference');
      assert.equal(error.message, 'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card.');
      return true;
    }
  );
  assert.deepEqual(client.calls, [], 'no request is sent for input the rules reject');
});

test('B3. every backend failure maps to specific copy — never "Application failed"', async () => {
  const cases: Array<[string, any, string, string]> = [
    ['duplicate (unique violation)', { code: '23505', message: 'Application already submitted' }, 'duplicate', PARTNER_APPLICATION_ERROR_MESSAGES.duplicate],
    ['duplicate KYC', { code: '23505', message: 'KYC document already used' }, 'duplicate', PARTNER_APPLICATION_ERROR_MESSAGES.duplicateKyc],
    ['HTTP 409', { status: 409, message: 'conflict' }, 'duplicate', PARTNER_APPLICATION_ERROR_MESSAGES.duplicate],
    ['already approved', { code: '22023', message: 'Growth Partner access is already active' }, 'approved', PARTNER_APPLICATION_ERROR_MESSAGES.approved],
    ['expired session', { code: '42501', message: 'permission denied' }, 'session', PARTNER_APPLICATION_ERROR_MESSAGES.session],
    ['PGRST301', { code: 'PGRST301', message: 'JWT expired' }, 'session', PARTNER_APPLICATION_ERROR_MESSAGES.session],
    ['missing migration', { code: 'PGRST202', message: 'Could not find the function' }, 'schema', PARTNER_APPLICATION_ERROR_MESSAGES.schema],
    ['network', { message: 'TypeError: Failed to fetch' }, 'network', PARTNER_APPLICATION_ERROR_MESSAGES.network],
    ['rate limit', { status: 429, message: 'Too many requests' }, 'rate-limit', PARTNER_APPLICATION_ERROR_MESSAGES.rateLimit],
    ['suspended', { code: '42501', message: 'user is banned' }, 'suspended', PARTNER_APPLICATION_ERROR_MESSAGES.suspended],
    ['unknown', { code: 'XX000', message: 'some driver text' }, 'unknown', PARTNER_APPLICATION_ERROR_MESSAGES.unknown],
  ];
  for (const [label, error, kind, message] of cases) {
    const mapped = toPartnerApplicationError(error);
    assert.equal(mapped.kind, kind, `${label}: kind`);
    assert.equal(mapped.message, message, `${label}: message`);
    assert.ok(!/Application failed/.test(mapped.message), `${label}: the old catch-all must never come back`);
  }
});

test('B4. a backend validation message keeps its field so the form can mark it', async () => {
  const mapped = toPartnerApplicationError({
    code: '22023',
    message: 'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card',
  });
  assert.equal(mapped.kind, 'validation');
  assert.equal(mapped.field, 'kycDocumentReference');
  assert.equal(mapped.message, 'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card');

  const phone = toPartnerApplicationError({ code: '22023', message: 'Enter a valid 10-digit mobile number' });
  assert.equal(phone.field, 'phone');

  // An unrecognized 22023 becomes safe generic copy, never raw database text.
  const raw = toPartnerApplicationError({ code: '22023', message: 'new row violates check constraint foo_bar' });
  assert.equal(raw.kind, 'validation');
  assert.equal(raw.message, 'Check your application details and try again.');
});

test('B5. no session → the user is told to sign in, and nothing is written', async () => {
  const client = fakeClient({ session: null });
  await assert.rejects(submitGrowthPartnerApplication(client, INPUT), (error: unknown) => {
    assert.ok(error instanceof PartnerApplicationError);
    assert.equal(error.kind, 'session');
    assert.equal(error.message, 'Your session expired. Please sign in again.');
    return true;
  });
  assert.deepEqual(client.calls, [], 'a signed-out visitor never reaches the write');
});

test('B6. a session read that throws is a network problem, not a signed-out one', async () => {
  const client = fakeClient({
    sessionThrows: true,
    rpc: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await assert.rejects(submitGrowthPartnerApplication(client, INPUT), (error: unknown) => {
    assert.ok(error instanceof PartnerApplicationError);
    assert.equal(error.kind, 'network');
    return true;
  });
  assert.equal(client.calls.length, 1, 'the write is still attempted, so the real answer decides');
});

test('B7. an existing pending application is refused before the request', async () => {
  const client = fakeClient({ application: { status: 'pending' } });
  await assert.rejects(submitGrowthPartnerApplication(client, INPUT, {
    fetchApplicationRow: async () => ({ status: 'pending' }),
  }), (error: unknown) => {
    assert.ok(error instanceof PartnerApplicationError);
    assert.equal(error.kind, 'duplicate');
    assert.equal(error.message, 'You have already submitted an application.');
    return true;
  });
  assert.deepEqual(client.calls, [], 'no duplicate write is attempted');
});

test('B8. a rejected application may be resubmitted; an approved one reports approval', async () => {
  const rejected = fakeClient();
  await submitGrowthPartnerApplication(rejected, INPUT, { fetchApplicationRow: async () => ({ status: 'rejected' }) });
  assert.equal(rejected.calls.length, 1, 'a rejected applicant can apply again');

  const approved = fakeClient();
  await assert.rejects(
    submitGrowthPartnerApplication(approved, INPUT, { fetchApplicationRow: async () => ({ status: 'approved' }) }),
    (error: unknown) => {
      assert.ok(error instanceof PartnerApplicationError);
      assert.equal(error.kind, 'approved');
      return true;
    }
  );
  assert.deepEqual(approved.calls, []);
});

test('B9. a failing duplicate pre-check never blocks a legitimate submission', async () => {
  const client = fakeClient();
  const result = await submitGrowthPartnerApplication(client, INPUT, {
    fetchApplicationRow: async () => {
      throw new Error('Network error');
    },
  });
  assert.equal(result.status, 'pending');
  assert.equal(client.calls.length, 1, 'the database remains the authority on duplicates');
});
