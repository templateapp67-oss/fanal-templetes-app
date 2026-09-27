// ============================================================================
// Auth password diagnostics — development only, lengths only, never content.
//
// When a password form misbehaves (e.g. "Password must be at least 6
// characters." while a 6+ character password is visibly filled in), the first
// question is whether React state and the submitted DOM value diverged. These
// helpers log exactly that comparison — CHARACTER LENGTHS ONLY — so a state
// mismatch can be debugged without password content ever reaching the console,
// log aggregators, or error reporters.
//
// Guarantees (all pinned by tests/passwordDiagnostics.test.ts):
//   • Dev-only: a silent no-op in production bundles (`import.meta.env.PROD`).
//   • Content-free: only `typeof`-derived numbers and booleans reach the
//     console. Password strings are measured, never printed or forwarded.
//   • Total: non-string inputs (null/undefined/objects) report a null length
//     instead of throwing.
// ============================================================================

export const AUTH_PASSWORD_DIAG_TAG = '[auth-password-diag]';

/**
 * Pure enablement decision, exported for tests: diagnostics run everywhere
 * except production bundles. Mirrors the repo's `canFabricateSession`
 * convention (pure predicate + detected singleton).
 */
export function canLogPasswordDiagnostics(isProdBuild: boolean): boolean {
  return isProdBuild !== true;
}

/**
 * True unless this is a production bundle. Read defensively: Node and test
 * runtimes have no `import.meta.env`, which means "not a production build".
 */
export const passwordDiagnosticsEnabled: boolean = (() => {
  try {
    return canLogPasswordDiagnostics((import.meta as any)?.env?.PROD === true);
  } catch {
    return true;
  }
})();

/** Length of a password-shaped value without ever exposing the value itself. */
export function passwordLengthOf(value: unknown): number | null {
  return typeof value === 'string' ? value.length : null;
}

export interface PasswordLengthReport {
  stateLength: number | null;
  submittedLength: number | null;
  /** True when both sides agree (the healthy case). */
  match: boolean;
}

/**
 * Build the length-only state-vs-submitted comparison. Pure, so tests can
 * assert the exact report shape without touching the console.
 */
export function comparePasswordLengths(
  stateValue: unknown,
  submittedValue: unknown
): PasswordLengthReport {
  const stateLength = passwordLengthOf(stateValue);
  const submittedLength = passwordLengthOf(submittedValue);
  return { stateLength, submittedLength, match: stateLength === submittedLength };
}

/**
 * Log a length-only state-vs-submitted comparison for one submit event.
 * No-op when diagnostics are disabled (production). NEVER passes password
 * content to the console — only the numeric report above.
 */
export function logPasswordLengths(
  event: string,
  stateValue: unknown,
  submittedValue: unknown
): void {
  if (!passwordDiagnosticsEnabled) return;
  const report = comparePasswordLengths(stateValue, submittedValue);
  console.debug(AUTH_PASSWORD_DIAG_TAG, event, {
    stateLength: report.stateLength,
    submittedLength: report.submittedLength,
    match: report.match,
  });
}
