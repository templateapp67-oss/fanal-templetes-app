// Relative imports in the Node/API graph MUST carry the `.js` extension: this
// module is transpiled file-by-file and loaded as native ESM (package.json has
// "type": "module"), so an extensionless specifier fails at runtime with
// ERR_MODULE_NOT_FOUND. See server/publicSocialShell.ts for the caller.
import { resolveTenantFromHost } from '../src/lib/tenant.js';
import { injectSocialMetadata } from '../src/lib/socialMetadata.js';

/** Public HTML rendering for the API runtime. No cookies/JWTs are forwarded. */
export async function renderPublicSocialPage(request: Request, fetcher: typeof fetch = fetch): Promise<Response | undefined> {
  const url = new URL(request.url);
  const site = url.searchParams.get('site') || '';
  if (url.pathname !== '/' || !['GET', 'HEAD'].includes(request.method)) return;
  if (url.searchParams.has('site') ? !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(site) : !resolveTenantFromHost(url.host)) return;
  try {
    const options = { signal: AbortSignal.timeout(6000), redirect: 'error' as const, cache: 'no-store' as const };
    const [documentResponse, siteResponse] = await Promise.all([
      fetcher(new URL('/index.html', url.origin), options),
      fetcher(new URL(site ? `/api/site/${encodeURIComponent(site)}` : '/api/site', url.origin), options),
    ]);
    if (!documentResponse.ok || !siteResponse.ok || !documentResponse.headers.get('content-type')?.includes('text/html')) return;
    const payload = await siteResponse.json();
    // Uses only the existing public lookup response; never reads owner snapshots here.
    if (!payload.found || !payload.salon?.profile) return;
    const html = injectSocialMetadata(await documentResponse.text(), payload.salon.profile, url.href);
    const headers = new Headers(documentResponse.headers);
    for (const key of ['content-length', 'content-encoding', 'etag', 'last-modified', 'set-cookie']) headers.delete(key);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store');
    return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
  } catch {
    // Site/API failure must not break the SPA; its existing error screen handles it.
    return;
  }
}
