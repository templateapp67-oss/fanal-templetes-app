// ============================================================================
// Failure LOGGING — the bug that made this issue undiagnosable for 71 migrations.
//
// What went wrong: when an RPC refused, `partnerOperationError` / `rpcError`
// replaced the real answer (`42501`, `PGRST202`, `23505`, the raised message)
// with safe copy, `toSafePartnerSectionError` flattened whatever was left, and
// NOTHING was written to the console or the logs. The partner saw "Could not
// verify your Growth Partner access" forever and nobody could name the cause.
//
// What must hold now, pinned here:
//   1. every failure that reaches a screen is logged exactly once;
//   2. the line carries the backend's OWN code/message/status and the call;
//   3. credentials, keys and emails are redacted before they are recorded;
//   4. the partner-facing copy is unchanged (still no driver text);
//   5. a healthy call logs nothing (no noise, no false alarms).
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPartnerAreaErrorLogged,
  logPartnerAreaFailure,
  partnerAreaFailureLogRecord,
  redactPartnerAreaLogText,
} from '../src/lib/partnerAreaFailure';
import { GrowthPartnerServiceError, growthPartnerService, isServiceFailure } from '../src/services/growthPartner';
import { fetchMyGrowthPartnerRow, ensureMyGrowthPartner, toSafePartnerSectionError } from '../src/lib/growthPartner';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface LogCall {
  prefix: string;
  fields: any;
}

/** Capture `console.error` while `run` executes. */
async function captureLogs(run: () => Promise<void>): Promise<{ logs: LogCall[]; raw: string }> {
  const original = console.error;
  const logs: LogCall[] = [];
  const raw: string[] = [];
  (console as any).error = (prefix?: unknown, fields?: unknown) => {
    logs.push({ prefix: String(prefix ?? ''), fields });
    raw.push(`${String(prefix ?? '')} ${JSON.stringify(fields)}`);
  };
  try {
    await run();
  } finally {
    (console as any).error = original;
  }
  return { logs, raw: raw.join('\n') };
}

/** Answer every PostgREST call with one RPC's failure (the API proxy 404s). */
function stubRpcFailure(fn: string, error: unknown, status = 400) {
  const original = (globalThis as any).fetch;
  const calls: Array<{ url: string; body: any }> = [];
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.includes('/api/partner/')) {
      return new Response(JSON.stringify({ error: { code: 'no_route', message: 'no proxy here' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes(`/rest/v1/rpc/${fn}`)) {
      return new Response(JSON.stringify(error), { status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: `unstubbed rpc: ${url}` }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, restore: () => ((globalThis as any).fetch = original) };
}

/** Answer every PostgREST call successfully. */
function stubRpcSuccess(payload: unknown) {
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: any) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    if (url.includes('/api/partner/')) {
      return new Response(JSON.stringify({ error: { code: 'no_route' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { restore: () => ((globalThis as any).fetch = original) };
}

// ---------------------------------------------------------------------------
// 1. The real answer reaches the log
// ---------------------------------------------------------------------------

test('a refused RPC logs the PostgREST code and message the backend actually sent', async () => {
  const network = stubRpcFailure('get_my_growth_partner', {
    code: '42501',
    message: 'permission denied for function get_my_growth_partner',
    details: null,
    hint: null,
  });
  try {
    const { logs } = await captureLogs(async () => {
      const result = await growthPartnerService.getMyPartner();
      assert.equal(isServiceFailure(result), true);
      // The partner still gets reviewed copy — the fix must not leak driver text.
      if (isServiceFailure(result)) {
        assert.doesNotMatch(result.error.message, /42501|permission denied/i);
      }
    });
    assert.equal(logs.length, 1, 'exactly one line for one failure');
    assert.match(logs[0].prefix, /^\[growth-partner\] gate\.read-partner-row failed/);
    assert.match(logs[0].prefix, /get_my_growth_partner/, 'the failing call is in the greppable line');
    assert.equal(logs[0].fields.operation, 'gate.read-partner-row');
    assert.equal(logs[0].fields.call, 'get_my_growth_partner');
    assert.equal(logs[0].fields.kind, 'permission-denied');
    assert.equal(logs[0].fields.owner, 'administrator');
    assert.equal(logs[0].fields.postgrest.code, '42501', 'the RLS code is the evidence');
    assert.match(logs[0].fields.postgrest.message, /permission denied for function get_my_growth_partner/);
    assert.ok(
      logs[0].fields.postgrest.status === null || logs[0].fields.postgrest.status === 400,
      'status is recorded whenever a layer knows it'
    );
  } finally {
    network.restore();
  }
});

test('a missing migration is logged as PGRST202, not as the sanitized hint the partner reads', async () => {
  const network = stubRpcFailure(
    'get_my_partner_earnings',
    {
      code: 'PGRST202',
      message: 'Could not find the function public.get_my_partner_earnings(p_limit, p_offset) in the schema cache',
    },
    404
  );
  try {
    const { logs } = await captureLogs(async () => {
      await growthPartnerService.getEarnings({ limit: 10, offset: 0 });
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0].prefix, /^\[growth-partner\] earnings\.load failed/);
    assert.equal(logs[0].fields.call, 'get_my_partner_earnings', 'the call that failed is named');
    assert.equal(logs[0].fields.kind, 'schema-missing');
    assert.equal(logs[0].fields.postgrest.code, 'PGRST202');
    assert.match(logs[0].fields.postgrest.message, /schema cache/);
  } finally {
    network.restore();
  }
});

test('the throw-based read path logs too — the login screens render copy only', async () => {
  const network = stubRpcFailure('get_my_growth_partner', {
    code: '42P01',
    message: 'relation "public.growth_partners" does not exist',
  });
  try {
    const { logs } = await captureLogs(async () => {
      await assert.rejects(() => fetchMyGrowthPartnerRow());
      // …and the screen's sanitizer adds nothing on top.
      try {
        await fetchMyGrowthPartnerRow();
      } catch (error) {
        toSafePartnerSectionError(error);
      }
    });
    // Two separate failed calls → two lines; neither is duplicated by the gate
    // or by the sanitizer.
    assert.equal(logs.length, 2, `expected one line per failure, got ${logs.length}`);
    for (const log of logs) {
      assert.match(log.prefix, /^\[growth-partner\] /);
      assert.equal(log.fields.postgrest.code, '42P01');
      assert.equal(log.fields.kind, 'schema-missing');
    }
  } finally {
    network.restore();
  }
});

test('the provisioning call names itself, so "it never activates" is diagnosable', async () => {
  const network = stubRpcFailure('ensure_my_growth_partner', {
    code: '23505',
    message: 'duplicate key value violates unique constraint "growth_partners_user_id_key"',
  });
  try {
    const { logs } = await captureLogs(async () => {
      await assert.rejects(() => ensureMyGrowthPartner());
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0].prefix, /^\[growth-partner\] gate\.provision-partner-row failed/);
    assert.equal(logs[0].fields.call, 'ensure_my_growth_partner');
    assert.equal(logs[0].fields.postgrest.code, '23505');
  } finally {
    network.restore();
  }
});

test('a failure that never passed a logging layer is caught by the sanitizer', async () => {
  const handBuilt = Object.assign(new Error('column referral_source does not exist'), { code: '42703' });
  assert.equal(isPartnerAreaErrorLogged(handBuilt), false);
  const { logs } = await captureLogs(async () => {
    toSafePartnerSectionError(handBuilt);
  });
  assert.equal(logs.length, 1, 'the last boundary before generic copy still records the cause');
  assert.equal(logs[0].fields.postgrest.code, '42703');
  assert.equal(logs[0].fields.operation, 'section.read');
});

// ---------------------------------------------------------------------------
// 2. One failure, one line — however many layers it crosses
// ---------------------------------------------------------------------------

test('crossing the facade, the wrapper and the sanitizer still logs once', async () => {
  const network = stubRpcFailure('get_my_partner_dashboard', {
    code: '42501',
    message: 'Active Growth Partner required',
  });
  try {
    const { logs } = await captureLogs(async () => {
      const result = await growthPartnerService.getDashboard();
      assert.equal(isServiceFailure(result), true);
      if (isServiceFailure(result)) {
        // The gate path: the section hands the service error to the sanitizer.
        toSafePartnerSectionError(result.error);
        // And it may be unwrapped/rethrown any number of times.
        GrowthPartnerServiceError.from(result.error);
        toSafePartnerSectionError(result.error);
      }
    });
    assert.equal(logs.length, 1, 'one real failure is one log line');
    assert.match(logs[0].prefix, /^\[growth-partner\] dashboard\.load failed/);
    assert.deepEqual(logs[0].fields.postgrest.code, '42501');
  } finally {
    network.restore();
  }
});

test('a healthy call logs nothing at all', async () => {
  const network = stubRpcSuccess({ currency: 'INR', totals: { lifetime_paise: 0, pending_paise: 0, available_paise: 0 }, transactions: [] });
  try {
    const { logs } = await captureLogs(async () => {
      const result = await growthPartnerService.getEarnings();
      assert.equal(isServiceFailure(result), false);
    });
    assert.deepEqual(logs, [], 'no logs, no noise, no false alarms');
  } finally {
    network.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. Redaction — the log is not a credential dump
// ---------------------------------------------------------------------------

test('credentials, keys and emails never reach a log line', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYmMiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.abcdefghijklmnopqrstuvwxyz';
  const text = [
    `Authorization: Bearer ${jwt}`,
    `apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadpart.signaturepart`,
    'password=hunter2Secret',
    'stripe sk_live_abcdef123456789',
    'razorpay_secret=rzp_test_ABCDEF123456',
    'contact meera.partner@salon.example for details',
  ].join('\n');

  const redacted = redactPartnerAreaLogText(text);
  for (const secret of [jwt, 'hunter2Secret', 'sk_live_abcdef123456789', 'rzp_test_ABCDEF123456', 'meera.partner@']) {
    assert.ok(!redacted.includes(secret), `${secret} must not survive redaction`);
  }
  assert.ok(redacted.includes('<redacted:jwt>'), 'tokens are visibly redacted, not silently dropped');
  assert.ok(redacted.includes('<redacted:email>@salon.example'), 'the domain survives for triage, the mailbox does not');
  // What matters for diagnosis is untouched.
  assert.ok(redactPartnerAreaLogText('permission denied for function get_my_partner_levels').includes('permission denied'));
});

test('the log record for a credential-bearing driver message is redacted end to end', () => {
  const error = Object.assign(new Error('new row violates row-level security policy (apikey=eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.qrstuvwxyz1234)'), {
    code: '42501',
  });
  const record = partnerAreaFailureLogRecord(error, { operation: 'gate.read-partner-row' });
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop'), 'no key material in the record');
  assert.ok(serialized.includes('<redacted'), 'and the operator can still see that something was redacted');
  assert.equal(record.fields.postgrest!.code, '42501', 'the classification evidence survives redaction');
});

test('a redaction failure can never break a screen', async () => {
  // A hostile/odd error shape must not throw out of the logger.
  const weird = new Error('boom') as Error & { code?: string };
  weird.code = '42501';
  Object.defineProperty(weird, 'message', {
    configurable: true,
    get() {
      throw new Error('message getter exploded');
    },
  });
  const { logs } = await captureLogs(async () => {
    // The logger swallows its own problems and still classifies.
    const failure = logPartnerAreaFailure(weird, { operation: 'hostile.input' });
    assert.ok(failure.kind, 'classification still returned');
  });
  assert.ok(logs.length <= 1, 'worst case is no line, never a throw');
});
