// ============================================================================
// "Row missing after ensure" is an ERROR — the checklist item that was failing.
//
// `ensureMyGrowthPartner()` used to end in `return data as GrowthPartner`. A
// cast is not a check: if the RPC resolved with `null` (an older or half-applied
// definition of `ensure_my_growth_partner()`, a project where the function
// returns void, a policy that swallowed the insert), the caller received a
// value typed as a partner row that was actually nothing. The gate read that as
// "signed in, not a partner", rendered the sign-up surface, and the real problem
// stayed invisible — the same silent failure this area exists to remove.
//
// The three cases below are the contract:
//   1. resolved null      → classified error + one log line (no silent success)
//   2. resolved no-identity → same
//   3. resolved a real row → the normalized row, and no log line
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureMyGrowthPartner } from '../src/lib/growthPartner';
import { PARTNER_CONTRACT_MISMATCH_CODE } from '../src/lib/partnerAreaFailure';
import { growthPartnerService, isServiceFailure } from '../src/services/growthPartner';

const PARTNER_ID = 'a0000000-0000-4000-8000-000000000001';

const VALID_ROW = {
  user_id: PARTNER_ID,
  referral_code: 'ALPHA01',
  is_active: true,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

/** Answer the ensure RPC with exactly this payload (the API proxy 404s). */
function stubEnsure(reply: unknown) {
  const original = (globalThis as any).fetch;
  const calls: Array<{ url: string; body: any }> = [];
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.includes('/api/partner/')) {
      return new Response(JSON.stringify({ error: { code: 'no_route' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => ((globalThis as any).fetch = original) };
}

async function captureLogs(run: () => Promise<void>): Promise<string[]> {
  const original = console.error;
  const lines: string[] = [];
  (console as any).error = (prefix?: unknown, fields?: unknown) => {
    lines.push(`${String(prefix ?? '')} ${JSON.stringify(fields)}`);
  };
  try {
    await run();
  } finally {
    (console as any).error = original;
  }
  return lines;
}

/** The classified error an ensure failure must produce. */
async function ensureRejects(reply: unknown) {
  const network = stubEnsure(reply);
  const failures: any[] = [];
  const logs = await captureLogs(async () => {
    await assert.rejects(
      () => ensureMyGrowthPartner(),
      (error: any) => {
        failures.push(error);
        return true;
      }
    );
  });
  network.restore();
  assert.equal(failures.length, 1, 'the call rejects rather than resolving');
  return { error: failures[0], logs };
}

// ---------------------------------------------------------------------------
// 1 + 2. A missing row is an error
// ---------------------------------------------------------------------------

test('ensure resolving null throws a classified contract error, not a silent null row', async () => {
  const { error, logs } = await ensureRejects(null);

  assert.equal(error.code, PARTNER_CONTRACT_MISMATCH_CODE, 'classified as a contract mismatch, not a generic throw');
  assert.match(error.message, /unexpected shape/i);
  assert.match(error.message, /user_id/, 'and it names the identity field that never arrived');
  assert.doesNotMatch(error.message, /null|undefined|\[object/i, 'the message is authored copy, not a dumped value');

  // The evidence still lands in the log, once.
  assert.equal(logs.length, 1, `expected one log line, got ${logs.length}`);
  assert.match(logs[0], /\[growth-partner\] gate\.provision-partner-row failed/);
  assert.match(logs[0], /ensure_my_growth_partner/, 'the failing call is named');
});

test('ensure resolving an object without an identity is the same error', async () => {
  const { error } = await ensureRejects({ referral_code: 'ALPHA01', is_active: true });
  assert.equal(error.code, PARTNER_CONTRACT_MISMATCH_CODE);
  assert.match(error.message, /user_id/);
});

test('an empty payload is refused too — {} is not a partner row', async () => {
  const { error } = await ensureRejects({});
  assert.equal(error.code, PARTNER_CONTRACT_MISMATCH_CODE);
});

test('the facade reports the missing row as { ok: false }, never as a success', async () => {
  const network = stubEnsure(null);
  try {
    const result = await growthPartnerService.ensureMyPartner();
    assert.equal(isServiceFailure(result), true, 'a null row must not become ok:true');
    if (isServiceFailure(result)) {
      assert.equal(result.error.kind, 'contract-mismatch');
      assert.equal(result.error.owner, 'administrator', 'this needs a migration fix, not a partner action');
      assert.equal(result.error.retryable, false, 'retrying cannot conjure the row');
      assert.equal(result.error.code, PARTNER_CONTRACT_MISMATCH_CODE);
    }
  } finally {
    network.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. A real row still works — and logs nothing
// ---------------------------------------------------------------------------

test('a real row is returned normalized, with no log line', async () => {
  const network = stubEnsure(VALID_ROW);
  const logs = await captureLogs(async () => {
    const row = await ensureMyGrowthPartner();
    assert.equal(row.user_id, PARTNER_ID);
    assert.equal(row.referral_code, 'ALPHA01');
    assert.equal(row.is_active, true);
  });
  network.restore();
  assert.deepEqual(logs, [], 'a healthy provisioning call is silent');

  const network2 = stubEnsure(VALID_ROW);
  try {
    const result = await growthPartnerService.ensureMyPartner();
    assert.equal(isServiceFailure(result), false);
    if (!isServiceFailure(result)) assert.equal(result.data.user_id, PARTNER_ID);
  } finally {
    network2.restore();
  }
});

test('an inactive row is still a real row — ensure never fakes activation', async () => {
  const network = stubEnsure({ ...VALID_ROW, is_active: false });
  try {
    const row = await ensureMyGrowthPartner();
    assert.equal(row.is_active, false, 'the suspension is preserved, not defaulted to true');
  } finally {
    network.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. The unsafe cast cannot come back
// ---------------------------------------------------------------------------

test('the source never casts the RPC payload into a partner row', () => {
  // Comments stripped: the fix's own explanation mentions the old cast, and a
  // pin must read code, not prose.
  const lib = readFileSync(new URL('../src/lib/growthPartner.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  assert.doesNotMatch(lib, /return data as GrowthPartner/, 'a cast is not a check');
  assert.match(lib, /normalizeGrowthPartnerRow\(data\)/, 'the payload is normalized');
  assert.match(lib, /if \(!row \|\| !row\.user_id\)/, 'and the identity is required');
});
