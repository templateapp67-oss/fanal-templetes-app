import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_PASSWORD_DIAG_TAG,
  canLogPasswordDiagnostics,
  comparePasswordLengths,
  logPasswordLengths,
  passwordDiagnosticsEnabled,
  passwordLengthOf,
} from '../src/lib/authPasswordDiagnostics';

// ============================================================================
// Auth password diagnostics — development only, lengths only, never content.
//
// These pin the three guarantees in src/lib/authPasswordDiagnostics.ts:
//   1. dev-only (silent in production bundles),
//   2. content-free (only typeof-derived numbers/booleans reach the console),
//   3. total (non-string inputs report null instead of throwing).
// ============================================================================

test('enablement: diagnostics run everywhere except production bundles', () => {
  assert.equal(canLogPasswordDiagnostics(false), true, 'dev/test builds log');
  assert.equal(canLogPasswordDiagnostics(true), false, 'production builds stay silent');
});

test('enablement: the test runtime counts as non-production', () => {
  // Node/test runtimes have no import.meta.env — that means "not a
  // production build", so diagnostics are on here.
  assert.equal(passwordDiagnosticsEnabled, true);
});

test('passwordLengthOf measures without exposing, and tolerates non-strings', () => {
  assert.equal(passwordLengthOf('Secret123!'), 10);
  assert.equal(passwordLengthOf(''), 0);
  assert.equal(passwordLengthOf('  abcde  '), 9, 'whitespace counts, nothing is trimmed');
  assert.equal(passwordLengthOf(null), null);
  assert.equal(passwordLengthOf(undefined), null);
  assert.equal(passwordLengthOf(12345), null);
  assert.equal(passwordLengthOf({ length: 6 }), null, 'no duck-typing on untrusted shapes');
});

test('comparePasswordLengths reports the stale-state signature', () => {
  assert.deepEqual(comparePasswordLengths('Secret1', 'Secret1'), {
    stateLength: 7,
    submittedLength: 7,
    match: true,
  });
  // The autofill bug signature: visible DOM value, empty React state.
  assert.deepEqual(comparePasswordLengths('', 'Secret1'), {
    stateLength: 0,
    submittedLength: 7,
    match: false,
  });
  assert.deepEqual(comparePasswordLengths(undefined, undefined), {
    stateLength: null,
    submittedLength: null,
    match: true,
  });
});

test('logPasswordLengths emits lengths only — password content never reaches the console', () => {
  const captured: unknown[][] = [];
  const original = console.debug;
  console.debug = (...args: unknown[]) => {
    captured.push(args);
  };
  try {
    logPasswordLengths('test:event', 'x', 'Sup3rSecret!#');
  } finally {
    console.debug = original;
  }
  assert.equal(captured.length, 1, 'exactly one debug line per call');
  const [tag, event, report] = captured[0] as [string, string, Record<string, unknown>];
  assert.equal(tag, AUTH_PASSWORD_DIAG_TAG);
  assert.equal(event, 'test:event');
  assert.deepEqual(report, { stateLength: 1, submittedLength: 13, match: false });
  assert.deepEqual(
    Object.keys(report).sort(),
    ['match', 'stateLength', 'submittedLength'],
    'the report carries numbers/booleans only — no room for content'
  );
  const leaked = JSON.stringify(captured);
  assert.doesNotMatch(leaked, /Sup3r/, 'no password content in the log output');
  assert.doesNotMatch(leaked, /Secret/, 'no password content in the log output');
});

test('logPasswordLengths tolerates non-string inputs without throwing', () => {
  const captured: unknown[][] = [];
  const original = console.debug;
  console.debug = (...args: unknown[]) => {
    captured.push(args);
  };
  try {
    logPasswordLengths('test:event', null, undefined);
  } finally {
    console.debug = original;
  }
  assert.equal(captured.length, 1);
  assert.deepEqual((captured[0] as any[])[2], {
    stateLength: null,
    submittedLength: null,
    match: true,
  });
});
