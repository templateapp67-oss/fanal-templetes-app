import { useCallback, useEffect, useState } from 'react';

// ============================================================================
// Minimal path routing.
//
// The app has no router dependency and switches screens with `AppView` state,
// so nothing had ever read `window.location.pathname`. This adds just enough
// path handling for one real URL — `/customer/bookings` — without pulling a
// router into a project that does not otherwise use one.
//
// Deep links already resolve: `vercel.json` rewrites every non-API path to
// `index.html`, the Express server has `app.get("*", ...)`, and Vite's dev
// middleware does the same. So the browser always gets the SPA; all that was
// missing was something looking at the path once it loaded.
// ============================================================================

export const MY_BOOKINGS_PATH = '/customer/bookings';
export const BOOKING_DETAIL_PREFIX = '/customer/booking';

/** Strip a trailing slash (keeping the bare "/") so both spellings match. */
export function normalizePath(pathname: string): string {
  const value = String(pathname ?? '').trim();
  if (!value || value === '/') return '/';
  return value.replace(/\/+$/, '') || '/';
}

/** True when the path is the customer's "My Bookings" page. */
export function isMyBookingsPath(pathname: string): boolean {
  return normalizePath(pathname).toLowerCase() === MY_BOOKINGS_PATH;
}

/** Canonical URL for one booking's detail page. */
export function bookingDetailPath(bookingId: string): string {
  return `${BOOKING_DETAIL_PREFIX}/${encodeURIComponent(String(bookingId ?? '').trim())}`;
}

/**
 * Extract the booking id from `/customer/booking/:bookingId`, or null.
 *
 * Matching on exact segments rather than a prefix is load-bearing: the list
 * lives at `/customer/bookings`, which *starts with* the detail prefix, so
 * `startsWith('/customer/booking')` would read the list page as a detail page
 * for a booking called "s".
 */
export function matchBookingDetailPath(pathname: string): string | null {
  const segments = normalizePath(pathname)
    .split('/')
    .filter((segment) => segment.length > 0);
  if (segments.length !== 3) return null;
  if (segments[0].toLowerCase() !== 'customer') return null;
  if (segments[1].toLowerCase() !== 'booking') return null;
  const id = segments[2];
  return id ? decodeURIComponent(id) : null;
}

function currentPath(): string {
  if (typeof window === 'undefined' || !window.location) return '/';
  return normalizePath(window.location.pathname);
}

/**
 * Track the current path and expose a `navigate` that keeps the URL and the
 * rendered screen in step. Subscribes to `popstate` so back/forward work.
 */
export function usePathRoute(): { path: string; navigate: (to: string) => void } {
  const [path, setPath] = useState<string>(currentPath);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    // Another part of the app may have pushed a route before this mounted.
    setPath(currentPath());
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    const next = normalizePath(to);
    if (typeof window === 'undefined' || !window.history?.pushState) {
      setPath(next);
      return;
    }
    if (normalizePath(window.location.pathname) === next) {
      setPath(next);
      return;
    }
    window.history.pushState({}, '', next);
    setPath(next);
  }, []);

  return { path, navigate };
}
