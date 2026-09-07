// ============================================================================
// Dependency-free CORS middleware — shared by the dev server (server.ts) and
// the serverless entrypoint (api/index.ts) so the two can't drift.
//
// Fixes the common "Failed to fetch" / "Access to fetch ... blocked by CORS
// policy" failure of the auto-save fallback: the editor talks to /api/*
// same-origin in the normal Vercel/preview flow, but when it is opened from a
// DIFFERENT origin than the API (split dev setup — vite on :5173 vs the API
// on :3000, a Vercel preview host, a custom domain, or a subdomain host) the
// browser aborts the cross-origin POST unless:
//   1. the OPTIONS preflight gets a 204 answer with the allow-methods /
//      allow-headers (a JSON POST always triggers a preflight), and
//   2. the real response carries Access-Control-Allow-Origin for the caller.
//
// Behavior:
//   • /api/* + Origin header → the origin is echoed in
//     Access-Control-Allow-Origin (+ Vary: Origin so proxies don't cache a
//     wrong origin)
//   • OPTIONS /api/*        → answered immediately with 204 + allow headers
//   • anything else         → untouched (same-origin traffic gets NO CORS
//     headers, exactly like before)
//
// Mount at the app root BEFORE the routes:  app.use(nexoraCors);
// ============================================================================

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, apikey, X-Client-Info';
const PREFLIGHT_MAX_AGE = '86400'; // let browsers cache the preflight for 24h

export function nexoraCors(req: any, res: any, next: any): void {
  const path = String(req.path || '');
  if (!path.startsWith('/api')) {
    next();
    return;
  }

  const originHeader = req.headers?.origin;
  const origin =
    typeof originHeader === 'string' && originHeader.length > 0 && originHeader !== 'null'
      ? originHeader
      : null;

  if (origin) {
    // Echo the requesting origin (instead of "*") so the rule stays explicit
    // and can be tightened later without breaking the normal flow.
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE);
    res.status(204).end();
    return;
  }

  next();
}
