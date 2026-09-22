/**
 * Edge Middleware for Nexora Salon OS & Growth Partner Portal.
 *
 * Uses standard Web Fetch API (Request / Response / Headers / URL) compatible
 * with Vercel Edge Middleware, Next.js, and Cloudflare Workers.
 *
 * Ensures that public partner auth surfaces (/partner/login, /partner/signup,
 * /partner/forgot-password, /partner/reset-password) are NEVER blocked or
 * redirected with access restriction errors by middleware role checks.
 */
export default function middleware(request: Request): Response | void {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. PUBLIC AUTH SURFACES:
  // Never intercept or require active partner credentials on the login/signup routes.
  const isPublicPartnerAuth =
    pathname === '/partner/login' ||
    pathname === '/partner/signup' ||
    pathname === '/partner/forgot-password' ||
    pathname.startsWith('/partner/reset-password') ||
    pathname === '/growth-partner/login';

  if (isPublicPartnerAuth) {
    return;
  }

  // 2. PROTECTED GROWTH PARTNER PORTAL:
  // /partner/dashboard, /partner/referrals, /partner/earnings, etc.
  if (pathname.startsWith('/partner') || pathname.startsWith('/growth-partner')) {
    const cookieHeader = request.headers.get('cookie') || '';
    const hasAuthCookie = /sb-.*-auth-token/.test(cookieHeader);
    const hasAuthHeader = request.headers.has('authorization');

    // If completely unauthenticated, redirect to partner login
    if (!hasAuthCookie && !hasAuthHeader) {
      const loginUrl = new URL('/partner/login', request.url);
      if (pathname !== '/partner' && pathname !== '/partner/dashboard') {
        loginUrl.searchParams.set('returnUrl', pathname);
      }
      return Response.redirect(loginUrl.toString(), 307);
    }
  }
}

export const config = {
  matcher: ['/partner/:path*', '/growth-partner/:path*'],
};
