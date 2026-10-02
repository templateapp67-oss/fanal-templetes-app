// ============================================================================
// Public-site routing middleware (Vercel).
//
// ---------------------------------------------------------------------------
// THIS FILE MUST STAY IMPORT-FREE.
// ---------------------------------------------------------------------------
// Vercel builds a root `middleware.ts` with @vercel/node: the entrypoint and
// every module it reaches are transpiled file-by-file and traced, and the
// result runs on the Edge runtime, which does not resolve those traced sibling
// modules. A single `import { renderPublicSocialPage } from
// './server/publicSocialPage'` therefore makes the middleware module fail to
// LOAD — before this file's own error handling can run — and Vercel answers
// every matched route with 500 MIDDLEWARE_INVOCATION_FAILED instead of serving
// the SPA. That is exactly what PR #121 shipped: the matcher gained '/' and
// the handler gained the import, so the app's home page went down.
//
// PR #123 restored the site by making this file a no-op. This is the
// edge-safe implementation it asked for: the file still has no imports, and
// the metadata now renders in the Node/API runtime behind GET
// /api/public-shell instead of at the edge.
//
// The rendered HTML is produced by the Node/API runtime behind
// GET /api/public-shell (server/publicSocialShell.ts), which reuses the same
// server/publicSocialPage.ts code the Express server uses. This file keeps to
// web-standard work only: read the URL, decide whether the request is a public
// salon home page, proxy the HTML.
//
// Every failure path returns `undefined`, which tells Vercel to continue to
// the static index.html. A metadata outage must never take a site down.
// ============================================================================

/** Salon slug accepted in `?site=<slug>` sharing links. */
const SITE_SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

/** Mirrors BASE_DOMAIN in src/lib/tenant.ts (kept local: no imports here). */
const BASE_DOMAIN = 'nexora.in';

/** Hosts that are the app itself, never a salon's own site. */
const APP_OWNED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', `www.${BASE_DOMAIN}`, BASE_DOMAIN]);

/** Hosting/preview infrastructure that is never a salon's own domain. */
const INFRA_HOST_SUFFIXES = [
  '.vercel.app',
  '.netlify.app',
  '.pages.dev',
  '.run.app',
  '.railway.app',
  '.onrender.com',
  '.fly.dev',
  '.e2b.app',
  '.supabase.co',
];

/** Upper bound for the /api/public-shell round trip before plain HTML is served. */
const SHELL_TIMEOUT_MS = 6000;

function normalizeHost(host: string): string {
  return (host || '').split(':')[0].trim().toLowerCase().replace(/\.$/, '');
}

/**
 * True when the host can be a salon site (generated subdomain or custom
 * domain). This mirrors resolveTenantFromHost() in src/lib/tenant.ts and is
 * duplicated on purpose: importing it would break the Edge bundle. A false
 * positive is harmless — the API re-resolves the tenant from the Host header,
 * answers "not found", and the plain index.html is served.
 */
function isPublicSiteHost(host: string): boolean {
  const value = normalizeHost(host);
  if (!value || APP_OWNED_HOSTS.has(value)) return false;
  return !INFRA_HOST_SUFFIXES.some((suffix) => value.endsWith(suffix));
}

/** True when this request is a public salon home page worth rendering. */
function isPublicSiteRoot(url: URL, method: string): boolean {
  if (url.pathname !== '/' || !['GET', 'HEAD'].includes(method)) return false;
  const site = url.searchParams.get('site') || '';
  return site ? SITE_SLUG.test(site) : isPublicSiteHost(url.host);
}

/** AbortSignal.timeout is not guaranteed on every runtime; degrade instead. */
function shellSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(SHELL_TIMEOUT_MS)
    : undefined;
}

function shellHeaders(): Headers {
  return new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
}

/**
 * Fetch the crawler-ready home page from the API runtime.
 *
 * No cookies, Authorization headers or other browser credentials are
 * forwarded: the rendered page is public by definition.
 */
export async function renderPublicSocialShell(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!isPublicSiteRoot(url, request.method)) return;
  try {
    const response = await fetcher(new URL(`/api/public-shell${url.search}`, url.origin), {
      method: request.method,
      signal: shellSignal(),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return;
    const html = request.method === 'HEAD' ? null : await response.text();
    return new Response(html, { status: 200, headers: shellHeaders() });
  } catch {
    // API/index.html failure must not break the SPA; it has its own error screen.
    return;
  }
}

export default function middleware(request: Request): Promise<Response | undefined> {
  try {
    return renderPublicSocialShell(request);
  } catch {
    // A metadata outage must never take a site down: continue to index.html.
    return Promise.resolve<Response | undefined>(undefined);
  }
}

export const config = {
  // '/' is the only route this middleware touches, which is also its whole
  // blast radius: if it ever fails to load, only the home page is affected.
  //
  // /partner/* and /growth-partner/* are deliberately NOT matched — they must
  // reach the SPA, where the browser restores its Supabase session and the
  // access check runs (usePartnerRouteGuard + PartnerRouteGuard +
  // PartnerPortalLogin):
  //   • logged-out visitors are redirected to the login page
  //     (`/partner/login` or `/growth-partner/login`) — or, on shared
  //     dashboard links where the redirect is suppressed, shown a clear
  //     Sign In button;
  //   • signed-in accounts without the Growth Partner role see the access
  //     card offering BOTH "Become a Growth Partner" (Sign Up) and
  //     "Sign In" (direct Login for an existing Growth Partner account).
  // Matching them here would only add a second place that can take those
  // routes down.
  matcher: ['/'],
};
