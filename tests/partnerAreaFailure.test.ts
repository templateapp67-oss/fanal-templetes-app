// ============================================================================
// Growth Partner area — failure classification.
//
// The bug these tests exist for: a partner reporting
//
//   "Could not load the Growth Partner area. Could not load this section.
//    Please try again." + "Hard refreshing and clearing cache/incognito mode
//    did not solve the issue."
//
// The screen was telling them to do the one thing that cannot work, and hiding
// the evidence from whoever could fix it. Every case below therefore asserts
// TWO things: the right cause is named, and the copy does not send the user
// down a retry loop that cannot end.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPartnerAreaSupportReport,
  classifyPartnerAreaFailure,
  maskPartnerAreaEmail,
  readPartnerAreaErrorDetail,
  safePartnerAreaDetail,
  PARTNER_AREA_ENROLLMENT_MIGRATION,
  type PartnerAreaFailureKind,
  type PartnerAreaErrorDetail,
} from '../src/lib/partnerAreaFailure';
import {
  GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE as RE_EXPORTED_MESSAGE,
  isMissingPartnerSchemaError as reExportedMissingSchema,
  isPartnerSuspendedError as reExportedSuspended,
  isSessionExpiredError as reExportedSessionExpired,
} from '../src/lib/growthPartner';
import {
  GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE,
  isMissingPartnerSchemaError,
  isPartnerSuspendedError,
  isSessionExpiredError,
} from '../src/lib/partnerAreaFailure';

/** PostgREST's exact answer when a function is not in the schema cache. */
const pgrst202 = {
  code: 'PGRST202',
  status: 404,
  message: 'Could not find the function public.ensure_my_growth_partner() in the schema cache',
  details: 'Searched for the function public.ensure_my_growth_partner without parameters.',
};

/** Postgres: the caller holds no EXECUTE privilege on the function. */
const insufficientPrivilege = {
  code: '42501',
  message: 'permission denied for function get_my_growth_partner',
};

test('the predicates have exactly ONE definition (the area front door re-exports them)', () => {
  // If these ever stop being the same function object, the screen and the
  // operator script can start disagreeing about what a failure means.
  assert.equal(isMissingPartnerSchemaError, reExportedMissingSchema);
  assert.equal(isSessionExpiredError, reExportedSessionExpired);
  assert.equal(isPartnerSuspendedError, reExportedSuspended);
  assert.equal(GROWTH_PARTNER_SCHEMA_MISSING_MESSAGE, RE_EXPORTED_MESSAGE);
});

test('a missing migration says so, names the migration, and never says "try again"', () => {
  for (const error of [pgrst202, new Error('function public.get_my_growth_partner() does not exist')]) {
    const failure = classifyPartnerAreaFailure(error);
    assert.equal(failure.kind, 'schema-missing');
    assert.equal(failure.scope, 'setup');
    assert.equal(failure.owner, 'administrator');
    assert.equal(failure.retryable, false, 'retrying a missing migration can never work');
    assert.match(failure.title, /database setup is missing/i);
    assert.match(failure.body, /cannot fix it/i);
    assert.match(failure.nextStep, /administrator/i);
    assert.match(failure.nextStep, /GROWTH_PARTNER_SETUP\.md/);
    assert.match(failure.nextStep, /verify:growth-partner/);
    assert.ok(failure.operatorAction?.includes(PARTNER_AREA_ENROLLMENT_MIGRATION));
    assert.doesNotMatch(failure.nextStep, /^try again/i);
  }
});

test('schema drift (a relation/column this project lacks) is an operator fix too', () => {
  const failure = classifyPartnerAreaFailure(new Error('relation "growth_onboarding" does not exist'));
  assert.equal(failure.kind, 'schema-missing');
  assert.equal(failure.owner, 'administrator');
  assert.equal(failure.retryable, false);
  // The identifier is summarised, not repeated: a screen or a shared report
  // must not disclose table/column names.
  assert.doesNotMatch(failure.safeDetail ?? '', /growth_onboarding/);
  assert.equal(failure.safeDetail, 'a relation or column this project does not have (schema drift)');
});

test('a driver dump around the drift signal leaks nothing onto the screen', () => {
  // The exact shape a real PostgREST failure can take: a SQLSTATE, a schema
  // detail and (in this test) a secret the screen must never echo.
  const failure = classifyPartnerAreaFailure({
    code: '42P01',
    message: 'relation SECRET_TABLE does not exist SQL password=SECRET',
  });
  assert.equal(failure.kind, 'schema-missing');
  const rendered = [failure.label, failure.scopeSentence, failure.title, failure.body, failure.nextStep, failure.safeDetail ?? ''].join(' ');
  // (`.sql` appears in the migration file names on purpose; the tokens that
  // must never appear are the identifiers and values from the driver message.)
  assert.doesNotMatch(rendered, /SECRET_TABLE|password=|42P01|\\bSELECT\\b/i);
});

test('a refused grant is reported as an account/permission problem, not a cache problem', () => {
  const failure = classifyPartnerAreaFailure(insufficientPrivilege);
  assert.equal(failure.kind, 'permission-denied');
  assert.equal(failure.scope, 'account');
  assert.equal(failure.owner, 'administrator');
  assert.equal(failure.retryable, false);
  assert.match(failure.scopeSentence, /account\/permission issue/i);
  assert.match(failure.scopeSentence, /not a browser, cache or cookie problem/i);
  assert.equal(failure.code, '42501');
  // Row-level-security refusals are the same class of answer.
  assert.equal(
    classifyPartnerAreaFailure(new Error('new row violates row-level security policy for table "growth_partners"')).kind,
    'permission-denied'
  );
});

test('an expired session asks for a sign-in, not a retry', () => {
  for (const error of [
    { status: 401, message: 'Unauthorized' },
    { code: 'PGRST301', message: 'JWT expired' },
    new Error('Sign in required'),
  ]) {
    const failure = classifyPartnerAreaFailure(error);
    assert.equal(failure.kind, 'session-expired');
    assert.equal(failure.owner, 'you');
    assert.equal(failure.actionLabel, 'Sign in again');
    assert.equal(failure.retryable, false);
    assert.match(failure.nextStep, /sign in again/i);
  }
});

test('a suspended account points at support (only an administrator can lift it)', () => {
  const failure = classifyPartnerAreaFailure(new Error('Growth Partner access is paused'));
  assert.equal(failure.kind, 'suspended');
  assert.equal(failure.owner, 'support');
  assert.equal(failure.retryable, false);
  assert.match(failure.nextStep, /support/i);
  assert.match(failure.operatorAction ?? '', /provision_growth_partner/);
});

test('"not an active partner" is an account state, never a generic failure', () => {
  const failure = classifyPartnerAreaFailure(new Error('Active Growth Partner required'));
  assert.equal(failure.kind, 'not-a-partner');
  assert.equal(failure.scope, 'account');
  assert.equal(failure.owner, 'support');
  assert.equal(failure.retryable, false);
  assert.match(failure.body, /active Growth Partner record/);
});

test('transport failures are blamed on the connection, not the account', () => {
  for (const error of [new TypeError('Failed to fetch'), new Error('fetch failed'), new Error('Connection timeout')]) {
    const failure = classifyPartnerAreaFailure(error);
    assert.equal(failure.kind, 'network');
    assert.equal(failure.scope, 'browser');
    assert.equal(failure.retryable, true);
    assert.match(failure.nextStep, /retry/i);
  }
});

test('an explicitly offline browser wins over everything else', () => {
  const failure = classifyPartnerAreaFailure(new TypeError('Failed to fetch'), { online: false });
  assert.equal(failure.kind, 'offline');
  assert.equal(failure.scope, 'browser');
  assert.equal(failure.retryable, true);
  assert.match(failure.title, /offline/i);
  assert.match(failure.nextStep, /reconnect/i);
  // Same error, online: the verdict is allowed to differ — that is the point.
  assert.equal(classifyPartnerAreaFailure(new TypeError('Failed to fetch'), { online: true }).kind, 'network');
});

test('5xx is an outage on the service side, not the user’s browser', () => {
  for (const error of [{ status: 503, message: 'Service Unavailable' }, { status: 500, message: 'Internal Server Error' }]) {
    const failure = classifyPartnerAreaFailure(error);
    assert.equal(failure.kind, 'outage');
    assert.equal(failure.scope, 'service');
    assert.equal(failure.retryable, true);
    assert.match(failure.scopeSentence, /platform-side/i);
  }
});

test('an unnameable failure admits it instead of inventing a cause', () => {
  const failure = classifyPartnerAreaFailure(new Error('duplicate key value violates unique constraint "x"'));
  assert.equal(failure.kind, 'unknown');
  assert.equal(failure.scope, 'unclear');
  assert.equal(failure.owner, 'support');
  assert.equal(failure.retryable, true);
  assert.match(failure.body, /did not match a cause the app can name/i);
  assert.match(failure.nextStep, /diagnose/i);
  assert.equal(failure.operatorAction, null);
});

test('every kind carries a complete, non-contradictory answer', () => {
  const samples: Array<[PartnerAreaFailureKind, unknown]> = [
    ['offline', new Error('Failed to fetch')],
    ['network', new Error('fetch failed')],
    ['session-expired', { status: 401, message: 'Unauthorized' }],
    ['suspended', new Error('Growth Partner access is suspended')],
    ['not-a-partner', new Error('Active Growth Partner required')],
    ['schema-missing', pgrst202],
    ['permission-denied', insufficientPrivilege],
    ['outage', { status: 502, message: 'Bad Gateway' }],
    ['unknown', new Error('???')],
  ];
  for (const [kind, error] of samples) {
    const failure = classifyPartnerAreaFailure(error, kind === 'offline' ? { online: false } : {});
    assert.equal(failure.kind, kind);
    for (const field of ['label', 'scopeSentence', 'title', 'body', 'nextStep', 'actionLabel'] as const) {
      assert.ok(failure[field] && failure[field].trim().length > 0, `${kind}.${field} must not be empty`);
    }
    assert.ok(['browser', 'account', 'service', 'setup', 'unclear'].includes(failure.scope));
    assert.ok(['you', 'support', 'administrator'].includes(failure.owner));
    // Rule of the screen: a cause a retry cannot fix must not read as "retry".
    if (!failure.retryable) assert.doesNotMatch(failure.nextStep, /\btry again\b/i);
  }
});

test('raw database text is only echoed when it is on the allow list', () => {
  assert.match(safePartnerAreaDetail(pgrst202) ?? '', /could not find the function/i);
  assert.match(safePartnerAreaDetail(insufficientPrivilege) ?? '', /permission denied for function/i);
  assert.equal(
    safePartnerAreaDetail(new Error('relation "growth_onboarding" does not exist')),
    'a relation or column this project does not have (schema drift)'
  );
  // Not on the list → summarised, never printed.
  assert.equal(safePartnerAreaDetail(new Error('duplicate key value violates unique constraint "secret_idx"')), null);
  assert.equal(safePartnerAreaDetail(new Error('select * from private.rows where token = \'abc\'')), null);
  assert.equal(safePartnerAreaDetail(null), null);
});

test('readPartnerAreaErrorDetail understands every shape a promise can reject with', () => {
  // The three fields the classifier reads…
  const required = (detail: PartnerAreaErrorDetail) => ({
    message: detail.message,
    code: detail.code,
    status: detail.status,
  });
  // …plus the raw PostgREST facts the LOG carries (absent unless a layer that
  // saw the backend preserved them — see partnerAreaFailureLogging.test.ts).
  const raw = (detail: PartnerAreaErrorDetail) => ({
    rawCode: detail.rawCode ?? null,
    rawMessage: detail.rawMessage ?? null,
    rawStatus: detail.rawStatus ?? null,
    call: detail.call ?? null,
  });

  assert.deepEqual(required(readPartnerAreaErrorDetail(pgrst202)), {
    message: pgrst202.message,
    code: 'PGRST202',
    status: 404,
  });
  assert.deepEqual(required(readPartnerAreaErrorDetail(new Error('boom'))), { message: 'boom', code: null, status: null });
  assert.deepEqual(required(readPartnerAreaErrorDetail('plain string')), { message: 'plain string', code: null, status: null });
  assert.deepEqual(required(readPartnerAreaErrorDetail({ code: 42501 })), { message: '', code: '42501', status: null });
  assert.deepEqual(required(readPartnerAreaErrorDetail(null)), { message: '', code: null, status: null });
  assert.deepEqual(required(readPartnerAreaErrorDetail({})), { message: '', code: null, status: null });

  // A plain promise rejection carries no raw backend facts, and that is not an
  // error: the log simply records what exists.
  assert.deepEqual(raw(readPartnerAreaErrorDetail(new Error('boom'))), {
    rawCode: null,
    rawMessage: null,
    rawStatus: null,
    call: null,
  });
});

test('the support report identifies the failure without leaking an identity or a key', () => {
  const failure = classifyPartnerAreaFailure(pgrst202, { online: true });
  const report = buildPartnerAreaSupportReport({
    failure,
    route: '/partner/dashboard',
    checkedAt: '2026-09-23T00:00:00.000Z',
    online: true,
    session: { signedIn: true, email: 'partner@example.com', expiresAt: '2026-09-23T01:00:00.000Z' },
    projectHost: 'project-ref.supabase.co',
    checks: [{ id: 'gate-read', label: 'Gate read (get_my_growth_partner)', status: 'fail', detail: 'missing migration' }],
  });

  assert.match(report, /Growth Partner access failure report/);
  assert.match(report, /Route: {4}\/partner\/dashboard/);
  assert.match(report, /Cause: {4}Database setup missing \(schema-missing · setup\)/);
  assert.match(report, /PGRST202/);
  assert.match(report, /project-ref\.supabase\.co/);
  assert.match(report, /\[fail\] Gate read/);
  assert.match(report, /no passwords, tokens or API keys/);

  // The address is masked; nothing that could be replayed is present.
  assert.match(report, /p••••••@example\.com/);
  assert.doesNotMatch(report, /partner@example\.com/);
  assert.doesNotMatch(report, /eyJ[A-Za-z0-9_-]{10,}/, 'no JWT');
  assert.doesNotMatch(report, /anon key|service_role|apikey=/i);
});

test('maskPartnerAreaEmail keeps the domain and hides the local part', () => {
  assert.equal(maskPartnerAreaEmail('partner@example.com'), 'p••••••@example.com');
  assert.equal(maskPartnerAreaEmail('a@b.co'), 'a•@b.co');
  assert.equal(maskPartnerAreaEmail('not-an-email'), 'n•••');
  assert.equal(maskPartnerAreaEmail(null), null);
  assert.equal(maskPartnerAreaEmail(''), null);
});
