// ============================================================================
// Express safety helpers shared by the dev server and the Vercel function.
// Express 4 does not forward rejected promises from async route handlers to
// error middleware. A single missed `await` would therefore become an
// unhandled rejection (and, on a serverless host, FUNCTION_INVOCATION_FAILED).
// ============================================================================

import { responseAlreadyEnded } from './dbGuard';

export type ExpressHandler = (req: any, res: any, next?: any) => any;

/**
 * Turn an async handler into an Express-4-safe handler. If a request timeout
 * already sent a response, the late rejection is logged by the normal error
 * path only when it is still useful; it must never attempt a second response.
 */
export function asyncRoute(handler: ExpressHandler): ExpressHandler {
  return (req: any, res: any, next: any) => {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') {
        result.catch((error: any) => {
          if (responseAlreadyEnded(res)) {
            console.warn('[API] Async route completed after the response ended:', error?.message || error);
            return;
          }
          next(error);
        });
      }
    } catch (error) {
      if (responseAlreadyEnded(res)) {
        console.warn('[API] Route threw after the response ended:', (error as any)?.message || error);
        return;
      }
      next(error);
    }
  };
}

/**
 * Vercel can invoke `api/index.ts` with the `/api` prefix stripped, depending
 * on whether the request arrived through a rewrite or directly at the
 * function. The app's routes are deliberately written with `/api/...` so they
 * also work when the same Express app is mounted on a normal server. Normalize
 * both shapes before Express performs route matching.
 */
export function normalizeApiRequestUrl(req: any, _res: any, next: any): void {
  const current = typeof req.url === 'string' && req.url ? req.url : '/';
  const headerCandidates = [
    req.headers?.['x-invoke-path'],
    req.headers?.['x-forwarded-uri'],
    req.headers?.['x-original-url'],
  ];
  const forwardedPath = headerCandidates.find(
    (value: any) => typeof value === 'string' && /^\/api\/(?!index\.ts(?:\?|$))/.test(value)
  );

  if (forwardedPath) {
    req.url = forwardedPath;
    return next();
  }

  if (!/^\/api(?:\/|$)/.test(current)) {
    req.url = `/api${current.startsWith('/') ? current : `/${current}`}`;
  }
  next();
}
