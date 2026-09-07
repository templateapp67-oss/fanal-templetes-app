// ============================================================================
// Process-level safety net.
//
// An unhandled promise rejection kills the Node process (Node >= 15) and, on a
// serverless platform, turns EVERY subsequent request into the platform's own
// HTML 500 page — which the SPA can only report as "Server error (HTTP 500)"
// with no detail. Logging them keeps the process alive and, crucially, prints
// the real stack next to the request that caused it.
// ============================================================================

let installed = false;

export function installProcessGuards(entrypoint: string): void {
  if (installed || typeof process === 'undefined' || typeof process.on !== 'function') return;
  installed = true;

  process.on('unhandledRejection', (reason: any) => {
    console.error(
      `[${entrypoint}] UNHANDLED PROMISE REJECTION — the request that caused this may have answered with an opaque 500:`,
      reason?.stack || reason?.message || reason
    );
  });

  process.on('uncaughtException', (err: any) => {
    console.error(
      `[${entrypoint}] UNCAUGHT EXCEPTION:`,
      err?.stack || err?.message || err
    );
  });
}
