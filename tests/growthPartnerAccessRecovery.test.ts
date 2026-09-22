// ============================================================================
// Growth Partner access recovery — client level.
//
// The access-error screen is only as good as the information it has. These
// tests pin the difference the login page now makes:
//
//   • "the database says this account is not a partner" (a clean, empty read)
//   • "this project has not had the migration applied" (PGRST202 / HTTP 404 for
//     a function that is not in PostgREST's schema cache)
//   • "the call failed" (network, permission)
//
// All three used to collapse into one generic message — "Could not verify your
// Growth Partner access. Please try again." — which is a dead end for the first
// two: retrying can never fix a missing migration.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approveDemoGrowthPartnerAccount,
  ensureMyGrowthPartner,
  isMissingPartnerSchemaError,
  GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE,
} from '../src/lib/growthPartner';

/** Replace global fetch with a PostgREST-shaped responder. */
function stubTransport(respond: () => { body: unknown; status?: number }) {
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => {
    const { body, status = 200 } = respond();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return () => {
    (globalThis as any).fetch = original;
  };
}

/** The exact error PostgREST returns when a function is not in the cache. */
const pgrst202 = () => ({
  body: {
    code: 'PGRST202',
    message:
      'Could not find the function public.ensure_my_growth_partner() in the schema cache',
    details: 'Searched for the function public.ensure_my_growth_partner without parameters.',
    hint: null,
  },
  status: 404,
});

test('a missing migration is classified separately from every other failure', () => {
  // PostgREST's own shapes.
  assert.equal(isMissingPartnerSchemaError({ code: 'PGRST202' }), true);
  assert.equal(isMissingPartnerSchemaError({ code: 'PGRST205' }), true);
  assert.equal(isMissingPartnerSchemaError({ code: 'PGRST204' }), true);
  assert.equal(isMissingPartnerSchemaError({ status: 404 }), true);
  assert.equal(
    isMissingPartnerSchemaError(
      new Error('Could not find the function public.get_my_growth_partner() in the schema cache')
    ),
    true
  );
  assert.equal(isMissingPartnerSchemaError(new Error('function public.foo() does not exist')), true);

  // Everything that is NOT "the schema is missing" must stay out of this bucket,
  // or a real refusal would be reported to the partner as a setup problem.
  assert.equal(isMissingPartnerSchemaError(null), false);
  assert.equal(isMissingPartnerSchemaError(undefined), false);
  assert.equal(isMissingPartnerSchemaError({ code: '42501', message: 'permission denied' }), false);
  assert.equal(isMissingPartnerSchemaError(new Error('Growth Partner access required')), false);
  assert.equal(isMissingPartnerSchemaError(new Error('Sign in required')), false);
  assert.equal(isMissingPartnerSchemaError(new TypeError('Failed to fetch')), false);

  // The operator-facing copy names the fix (a migration), never "try again".
  assert.match(GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE, /migration/i);
  assert.doesNotMatch(GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE, /try again/i);
});

test('ensureMyGrowthPartner() reports a missing migration as such, and a real row as a partner', async () => {
  const missing = stubTransport(pgrst202);
  try {
    await assert.rejects(ensureMyGrowthPartner(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match((error as Error).message, /Growth Partner activation failed/);
      assert.equal(isMissingPartnerSchemaError(error), true, 'the caller can tell this is a setup problem');
      return true;
    });
  } finally {
    missing();
  }

  const present = stubTransport(() => ({
    body: { user_id: 'a0000000-0000-4000-8000-000000000001', referral_code: 'NEXORA-ABC123', is_active: true },
  }));
  try {
    const row = await ensureMyGrowthPartner();
    assert.equal(row.referral_code, 'NEXORA-ABC123');
    assert.equal(row.is_active, true);
    assert.equal(isMissingPartnerSchemaError(null), false);
  } finally {
    present();
  }
});

test('approveDemoGrowthPartnerAccount() never resolves as a silent no-op', async () => {
  // Success (the button on the denial screens): a real partner row comes back.
  const ok = stubTransport(() => ({
    body: { user_id: 'a0000000-0000-4000-8000-000000000002', referral_code: 'NEXORA-SELF01', is_active: true },
  }));
  try {
    const row = await approveDemoGrowthPartnerAccount();
    assert.equal(row.user_id, 'a0000000-0000-4000-8000-000000000002');
    assert.equal(row.referral_code, 'NEXORA-SELF01');
    assert.equal(row.is_active, true);
  } finally {
    ok();
  }

  // A payload that carries no partner row is a failure, not a success: the
  // button must not reload the page onto the same denial.
  const empty = stubTransport(() => ({ body: null }));
  try {
    await assert.rejects(approveDemoGrowthPartnerAccount(), /no partner row/i);
  } finally {
    empty();
  }

  // A missing migration must throw something a caller can classify.
  const missing = stubTransport(pgrst202);
  try {
    await assert.rejects(approveDemoGrowthPartnerAccount(), (error: unknown) => {
      assert.equal(isMissingPartnerSchemaError(error), true);
      return true;
    });
  } finally {
    missing();
  }

  // A refusal (suspended / not allowed) is propagated, never swallowed.
  const denied = stubTransport(() => ({
    body: { code: '42501', message: 'Growth Partner access is paused' },
    status: 403,
  }));
  try {
    await assert.rejects(approveDemoGrowthPartnerAccount(), /Growth Partner activation failed/);
  } finally {
    denied();
  }
});
