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
export const STAFF_PERFORMANCE_PATH = '/owner/dashboard/staff-performance';
export const STAFF_COMMISSION_PATH = '/owner/dashboard/staff-performance/commission';
export const OWNER_STAFF_PERFORMANCE_PATH = STAFF_PERFORMANCE_PATH;

// ---------------------------------------------------------------------------
// Customer App (`/app/...`)
// ---------------------------------------------------------------------------
// The Customer App is a second surface of the same deployment: its own path
// namespace, its own sub-navigation, and no changes to the owner screens. Like
// the booking pages it is state-driven from the URL, so a refresh or a shared
// deep link lands on the same screen.
export const CUSTOMER_APP_ROOT = '/app';

export type CustomerSection =
  | 'auth'
  | 'profile'
  | 'location'
  | 'home'
  | 'salon'
  | 'book'
  | 'bookings'
  | 'booking'
  | 'reviews'
  | 'favourites'
  | 'wallet'
  | 'qr'
  | 'pass'
  | 'membership'
  | 'referral'
  | 'notifications'
  | 'offers'
  | 'settings'
  | 'data';

export interface CustomerRoute {
  section: CustomerSection;
  /** `:id` segment for salon/booking routes (id or subdomain). */
  id: string;
  /** Second id segment, e.g. `/app/salon/:id/services` as a tab. */
  tab: string;
}

/** True when the path belongs to the Customer App at all. */
export function isCustomerAppPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === CUSTOMER_APP_ROOT || path.startsWith(`${CUSTOMER_APP_ROOT}/`);
}

const CUSTOMER_SECTIONS: Record<string, CustomerSection> = {
  '': 'home',
  auth: 'auth',
  signin: 'auth',
  profile: 'profile',
  me: 'profile',
  location: 'location',
  home: 'home',
  search: 'home',
  salon: 'salon',
  book: 'book',
  bookings: 'bookings',
  booking: 'booking',
  reviews: 'reviews',
  favourites: 'favourites',
  wallet: 'wallet',
  rewards: 'wallet',
  qr: 'qr',
  pass: 'pass',
  salonpass: 'pass',
  membership: 'membership',
  referral: 'referral',
  referrals: 'referral',
  notifications: 'notifications',
  offers: 'offers',
  data: 'data',
  settings: 'settings',
  support: 'settings',
  privacy: 'settings',
};

/**
 * Parse `/app`, `/app/salon/:id`, `/app/salon/:id/services`, `/app/booking/:id`.
 * Unknown sub-paths fall back to `home` rather than a blank screen: a typo in a
 * shared link should still land the customer somewhere they can use.
 */
export function matchCustomerRoute(pathname: string): CustomerRoute {
  const path = normalizePath(pathname);
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments[0]?.toLowerCase() !== 'app') return { section: 'home', id: '', tab: '' };
  const raw = segments.slice(1);
  const head = String(raw[0] || '').toLowerCase();
  const section = CUSTOMER_SECTIONS[head] ?? 'home';
  // Salon/booking routes carry an id; `salon` also carries a tab.
  const id = section === 'salon' || section === 'book' || section === 'booking' ? decodeURIComponent(raw[1] || '') : '';
  const tab = section === 'salon' ? decodeURIComponent(raw[2] || '') : '';
  return { section, id, tab };
}

export function customerPath(section: CustomerSection, id = '', tab = ''): string {
  const parts = [CUSTOMER_APP_ROOT];
  if (section !== 'home') parts.push(section);
  if (id) parts.push(encodeURIComponent(id));
  if (tab) parts.push(tab);
  return parts.join('/');
}

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

/** True when the path is the owner-only Staff Performance dashboard. */
export function isStaffPerformancePath(pathname: string): boolean {
  return normalizePath(pathname).toLowerCase() === STAFF_PERFORMANCE_PATH;
}

/** Alias used by the main-line staff dashboard route. */
export function isOwnerStaffPerformancePath(pathname: string): boolean {
  return isStaffPerformancePath(pathname);
}

/** True when the path is the owner-only Staff Commission settings + payouts page. */
export function isStaffCommissionPath(pathname: string): boolean {
  return normalizePath(pathname).toLowerCase() === STAFF_COMMISSION_PATH;
}

// ---------------------------------------------------------------------------
// Growth Partner area (`/growth-partner/...`)
// ---------------------------------------------------------------------------
// Second surface of the same deployment, same Supabase Auth/database/backend.
// All six sections are real in Phase 6 (commission honestly reports that no
// partner commission model exists yet). Unknown sub-paths fall back to
// `dashboard` rather than a blank screen.
export const GROWTH_PARTNER_PATH = '/growth-partner';

export type GrowthPartnerSection =
  | 'dashboard'
  | 'referrals'
  | 'customers'
  | 'performance'
  | 'commission'
  | 'profile';

export const GROWTH_PARTNER_SECTIONS: GrowthPartnerSection[] = [
  'dashboard',
  'referrals',
  'customers',
  'performance',
  'commission',
  'profile',
];

/** True when the path belongs to the Growth Partner area at all. */
export function isGrowthPartnerPath(pathname: string): boolean {
  const path = normalizePath(pathname).toLowerCase();
  return path === GROWTH_PARTNER_PATH || path.startsWith(`${GROWTH_PARTNER_PATH}/`);
}

/** Section for `/growth-partner` (dashboard) and `/growth-partner/:section`. */
export function matchGrowthPartnerRoute(pathname: string): GrowthPartnerSection {
  const segments = normalizePath(pathname)
    .split('/')
    .filter((segment) => segment.length > 0);
  if (segments[0]?.toLowerCase() !== 'growth-partner') return 'dashboard';
  const raw = String(segments[1] || '').toLowerCase();
  return (GROWTH_PARTNER_SECTIONS as string[]).includes(raw)
    ? (raw as GrowthPartnerSection)
    : 'dashboard';
}

/** Canonical URL for a Growth Partner section. */
export function growthPartnerPath(section: GrowthPartnerSection = 'dashboard'): string {
  return section === 'dashboard' ? GROWTH_PARTNER_PATH : `${GROWTH_PARTNER_PATH}/${section}`;
}

// ---------------------------------------------------------------------------
// Onboarding App (`/onboarding/...`)
// ---------------------------------------------------------------------------
// A separate frontend surface of the same deployment — same Supabase project,
// same Auth, same database/RPCs/RLS as the Template App. Auth screens are
// public; referral + status are protected (the app resolves the final route
// from the backend onboarding state, so refreshes and deep links land on the
// correct screen). Unknown sub-paths fall back to `login`, never blank.
export const ONBOARDING_PATH = '/onboarding';

export type OnboardingSection = 'login' | 'signup' | 'forgot-password' | 'referral' | 'status';

export const ONBOARDING_SECTIONS: OnboardingSection[] = [
  'login',
  'signup',
  'forgot-password',
  'referral',
  'status',
];

/** True when the path belongs to the Onboarding App at all. */
export function isOnboardingPath(pathname: string): boolean {
  const path = normalizePath(pathname).toLowerCase();
  return path === ONBOARDING_PATH || path.startsWith(`${ONBOARDING_PATH}/`);
}

/** Section for `/onboarding` (login) and `/onboarding/:section`. */
export function matchOnboardingRoute(pathname: string): OnboardingSection {
  const segments = normalizePath(pathname)
    .split('/')
    .filter((segment) => segment.length > 0);
  if (segments[0]?.toLowerCase() !== 'onboarding') return 'login';
  const raw = String(segments[1] || '').toLowerCase();
  return (ONBOARDING_SECTIONS as string[]).includes(raw) ? (raw as OnboardingSection) : 'login';
}

/** Canonical URL for an Onboarding App section. */
export function onboardingPath(section: OnboardingSection = 'login'): string {
  return section === 'login' ? `${ONBOARDING_PATH}/login` : `${ONBOARDING_PATH}/${section}`;
}

// ---------------------------------------------------------------------------
// Template App handoff (`/onboarding/handoff?token=…&state=…`)
// ---------------------------------------------------------------------------
// The Template App side of the Phase 4 one-time handoff. The path lives under
// `/onboarding` but is NOT an onboarding screen: App.tsx renders the handoff
// page for it BEFORE the Onboarding App branch. The query carries only the
// short-lived opaque token (+ anti-CSRF state) — never identity, which the
// backend derives from the authenticated session during the exchange.
export const TEMPLATE_HANDOFF_PATH = '/onboarding/handoff';

/** True when the path is the Template App handoff page (query ignored). */
export function isTemplateHandoffPath(pathname: string): boolean {
  return normalizePath(pathname).toLowerCase() === TEMPLATE_HANDOFF_PATH;
}

export interface TemplateHandoffQuery {
  token: string;
  state: string;
}

/** Parse `?token=…&state=…` without touching window (SSR/test safe). */
export function matchTemplateHandoffQuery(search: string): TemplateHandoffQuery {
  try {
    const params = new URLSearchParams(String(search || ''));
    return {
      token: (params.get('token') || '').trim(),
      state: (params.get('state') || '').trim(),
    };
  } catch {
    return { token: '', state: '' };
  }
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
