// ============================================================================
// GET /api/public-shell — crawler-ready HTML for a public salon home page.
//
// Why this route exists:
//
// The Vercel middleware (root middleware.ts) runs on the Edge runtime, which
// does not resolve the sibling modules a local `import` would pull in. It has
// to stay import-free, so it cannot build the OG/Twitter metadata itself — it
// calls this route and returns whatever HTML comes back. The heavy work
// (Supabase lookup + HTML injection) therefore happens here, in the Node
// runtime, where the same server/publicSocialPage.ts code the Express server
// uses can be imported normally.
//
// The Express server (server.ts) serves identical HTML inline at '/', so a
// self-hosted deployment and the Vercel deployment agree on what a crawler
// sees.
// ============================================================================

import { renderPublicSocialPage } from './publicSocialPage.js';

type ExpressRequest = any;
type ExpressResponse = any;

/**
 * Rebuild the public URL the shell is rendered for.
 *
 * The incoming request is `/api/public-shell?site=…`; the renderer expects the
 * public URL (`/?site=…`) because it resolves the tenant from the Host header
 * and fetches `/index.html` from the same origin.
 */
function shellRequestUrl(req: ExpressRequest): string | null {
  const host = req?.headers?.host || (typeof req?.get === 'function' ? req.get('host') : '') || '';
  if (!host) return null;
  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  const protocol = forwardedProto === 'https' || req?.protocol === 'https' ? 'https' : 'http';
  const original = typeof req?.originalUrl === 'string' ? req.originalUrl : '/';
  const query = original.includes('?') ? original.slice(original.indexOf('?')) : '';
  return `${protocol}://${host}/${query}`;
}

/**
 * Express handler. Renders the social/metadata shell, or calls `next()` so the
 * normal 404/SPA handling takes over when there is nothing to render.
 */
export async function publicSocialShellHandler(
  req: ExpressRequest,
  res: ExpressResponse,
  next: () => void,
): Promise<void> {
  const url = shellRequestUrl(req);
  if (!url) return next();
  try {
    const isHead = req?.method === 'HEAD';
    const response = await renderPublicSocialPage(new Request(url, { method: isHead ? 'HEAD' : 'GET' }));
    if (!response) return next();
    const html = isHead ? '' : await response.text();
    res
      .status(200)
      .set('content-type', 'text/html; charset=utf-8')
      .set('cache-control', 'no-store')
      .send(html);
  } catch (err) {
    console.warn('[Public shell] Falling back to the SPA shell:', (err as Error)?.message || err);
    next();
  }
}
