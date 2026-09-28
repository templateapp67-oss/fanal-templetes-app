import { renderPublicSocialPage } from './server/publicSocialPage';

/**
 * Partner routes serve the SPA shell, not private data.
 *
 * The browser Supabase client restores its session from localStorage or
 * sessionStorage (see authRememberStorage.ts), neither of which accompanies
 * a document request. A cookie/header-presence check at the edge therefore
 * redirects even signed-in partners on a direct visit or refresh.
 *
 * Let the SPA restore Auth and run PartnerRouteGuard. Private reads/writes
 * remain protected by verified bearer tokens and Supabase RLS/RPC checks;
 * serving index.html does not authorize access to partner data.
 */
export default function middleware(request: Request): void | Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname === '/') return renderPublicSocialPage(request);
  return;
}

export const config = {
  matcher: ['/', '/partner/:path*', '/growth-partner/:path*'],
};
