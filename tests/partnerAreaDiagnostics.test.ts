// ============================================================================
// Live diagnosis — the parts that must hold without a network.
//
// The DOM suite drives the real probes against a stubbed PostgREST. This file
// pins the two properties that keep the diagnostic safe to press in any
// environment:
//
//   • in mock mode (no Supabase configured) it makes NO network calls at all —
//     it says the project is missing and skips the live checks;
//   • it reports the failure it was handed (not a fresh guess) even when
//     nothing can be probed, so the button is still useful offline.
//
// It also pins the rule that matters most for a diagnostic run against a real
// account: `ensure_my_growth_partner()` — the one call that can CREATE a
// partner record — is never invoked by the probe.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPartnerAreaReportFromDiagnostics, runPartnerAreaDiagnostics } from '../src/lib/partnerAreaDiagnostics';
import { findDiagnosticProbeFunctionNames } from '../src/lib/partnerAreaDiagnostics';

const pgrst202 = Object.assign(
  new Error('Could not find the function public.get_my_growth_partner() in the schema cache'),
  { code: 'PGRST202', status: 404 }
);

test('without a configured project the diagnostic says so and touches nothing', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('the diagnostic must not reach the network in mock mode');
  }) as typeof fetch;
  try {
    const report = await runPartnerAreaDiagnostics({ error: pgrst202, route: '/partner/dashboard' });
    assert.equal(calls, 0);
    assert.equal(report.failure.kind, 'schema-missing');
    assert.equal(report.route, '/partner/dashboard');
    assert.equal(report.projectHost, null);

    const byId = Object.fromEntries(report.checks.map((check) => [check.id, check]));
    assert.equal(byId.project.status, 'fail');
    assert.match(byId.project.detail ?? '', /mock mode|Supabase project/i);
    assert.equal(byId.live.status, 'skipped');
    // No nonsense verdicts about a session or a database it never reached.
    assert.equal(byId.session, undefined);
    assert.equal(byId['gate-read'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the report built from a diagnostic run names the failure, not the environment', async () => {
  const report = await runPartnerAreaDiagnostics({ error: pgrst202 });
  const text = buildPartnerAreaReportFromDiagnostics(report);
  assert.match(text, /Cause: {4}Database setup missing \(schema-missing · setup\)/);
  assert.match(text, /Route: {4}\/partner\/dashboard/);
  assert.match(text, /\[fail\] Supabase project configured/);
  assert.doesNotMatch(text, /anon key|service_role/i);
});

test('the probe plan never includes the call that can create a partner record', () => {
  // This is a hard rule, not a style preference: a diagnostic must not change
  // the account it is diagnosing. `ensure_my_growth_partner()` provisions the
  // caller's row, so the probe reports it as "not probed" instead.
  assert.ok(!findDiagnosticProbeFunctionNames().includes('ensure_my_growth_partner'));
  assert.deepEqual(findDiagnosticProbeFunctionNames().sort(), ['get_my_growth_partner', 'get_my_partner_dashboard']);
});
