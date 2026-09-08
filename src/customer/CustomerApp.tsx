// ============================================================================
// Nexora SalonOS — Customer App shell (`/app`).
//
// A second surface of the same deployment, not a fork of the owner app: it owns
// its path namespace and its own screens, while the owner dashboard at `/` is
// untouched. Two rules hold it together:
//
//   1. Data. Every screen gets its data from `src/lib/customer/api.ts`, which is
//      the only thing that talks to the Express API. Nothing in here calls
//      Supabase for catalogue data (owner-only RLS would answer with zero rows)
//      and nothing imports `src/mockData.ts`.
//   2. Session. Identity comes from the existing Supabase auth session
//      (`currentCustomerUser`). The customer never types an id: the API derives
//      it from the bearer token, so one customer can't read another's rows.
//
// The shell also owns the two gates the flow depends on — sign in before
// booking, and a city before discovery results can be sorted by distance.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, Compass, LogOut, Sparkles, User, Wallet } from 'lucide-react';
import { customerPath, matchCustomerRoute, normalizePath, type CustomerSection } from '../lib/router';
import { currentCustomerUser, customerBackendConnected, getSalon, invalidateCustomerData } from '../lib/customer/api';
import { readLocation } from '../lib/customer/deviceStore';
import { supabase } from '../lib/supabaseClient';
import { ACCENT_PALETTES, type AccentPaletteKey } from '../themeAccents';
import type { CustomerSalon } from '../lib/customer/types';
import { AuthScreen } from './screens/Auth';
import { HomeScreen, SalonScreen, type SalonTab } from './screens/Discover';
import { BookingFlow } from './screens/Book';
import { BookingsScreen } from './screens/Bookings';
import { RewardsScreen } from './screens/Rewards';
import { ActivityScreen } from './screens/Activity';
import { LocationScreen, ProfileScreen } from './screens/Me';
import { Button, CARD_CLASS, Chip, MUTED_CLASS } from './ui';

export interface CustomerAppProps {
  /** Current path, from the same `usePathRoute` the owner app uses. */
  path: string;
  navigate: (to: string) => void;
  /**
   * Accent from the tenant the request arrived on (white-label subdomain), so a
   * customer app opened at `blrsalon.nexora.app` wears that salon's palette
   * before their own salon row has even loaded. Omitted on the shared host.
   */
  accentHex?: string;
  tenantSubdomain?: string;
  tenantName?: string;
}

const NAV: Array<{ section: CustomerSection; label: string; icon: React.ReactNode }> = [
  { section: 'home', label: 'Explore', icon: <Compass className="w-5 h-5" /> },
  { section: 'bookings', label: 'Bookings', icon: <CalendarDays className="w-5 h-5" /> },
  { section: 'wallet', label: 'Rewards', icon: <Wallet className="w-5 h-5" /> },
  { section: 'notifications', label: 'Activity', icon: <Bell className="w-5 h-5" /> },
  { section: 'profile', label: 'Profile', icon: <User className="w-5 h-5" /> },
];

/** Screens that are meaningless without an account (booking is the whole point). */
const PRIVATE: CustomerSection[] = ['bookings', 'booking', 'profile', 'wallet', 'qr', 'membership', 'referral', 'notifications', 'favourites', 'reviews', 'offers'];

export const CustomerApp: React.FC<CustomerAppProps> = ({ path, navigate, accentHex: tenantAccentHex = '', tenantSubdomain = '', tenantName = '' }) => {
  const route = useMemo(() => matchCustomerRoute(path), [path]);
  const [session, setSession] = useState<{ id: string; email?: string } | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [salon, setSalon] = useState<CustomerSalon | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [pendingAfterAuth, setPendingAfterAuth] = useState('');

  // The session is read once here and pushed down; screens never call
  // `supabase.auth` themselves so the notion of "who is signed in" lives in one
  // place.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const user = await currentCustomerUser();
      if (cancelled) return;
      setSession(user);
      setCheckingSession(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onFocus = () => {
      void (async () => {
        const user = await currentCustomerUser();
        setSession(user);
      })();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const go = useCallback(
    (section: CustomerSection, id = '', tab = '') => navigate(customerPath(section, id, tab)),
    [navigate]
  );

  // A tenant host means the salon is already known, so `/app` opens their page
  // instead of a search screen with one result in it. Only for the bare root, so
  // a deliberate "browse everything" tap is never undone.
  useEffect(() => {
    if (!tenantSubdomain) return;
    if (matchCustomerRoute(path).section !== 'home') return;
    if (normalizePath(path) !== customerPath('home')) return;
    navigate(customerPath('salon', tenantSubdomain));
  }, [tenantSubdomain, path, navigate]);

  const requireAuth = useCallback(
    (returnTo: string) => {
      setAuthMode('login');
      setPendingAfterAuth(returnTo);
      go('auth');
    },
    [go]
  );

  const onAuthenticated = useCallback(
    (user: { id: string; email?: string }) => {
      setSession(user);
      setRefreshToken((token) => token + 1);
      invalidateCustomerData('signed-in');
      if (pendingAfterAuth) {
        const target = pendingAfterAuth;
        setPendingAfterAuth('');
        navigate(target);
        return;
      }
      go('home');
    },
    [pendingAfterAuth, navigate, go]
  );

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      // A failed sign-out must still drop the local session, or the app is stuck
      // showing somebody else's bookings.
    }
    setSession(null);
    setRefreshToken((token) => token + 1);
    invalidateCustomerData('signed-out');
    go('home');
  }

  // The salon row drives the header (name + accent), so the customer app wears
  // the salon's own theme instead of a generic one. Read-only.
  useEffect(() => {
    const id = route.section === 'salon' || route.section === 'book' ? route.id : '';
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const result = await getSalon(id);
      if (!cancelled && result.ok) setSalon((result.data as CustomerSalon) || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [route.section, route.id]);

  // Tenant palette first, then the salon row's own palette once it loads — the
  // same `profiles.theme_accent_key` value, resolved by the same table.
  const accentHex = useMemo(() => (salon ? accentFrom(salon) : tenantAccentHex || DEFAULT_ACCENT), [salon, tenantAccentHex]);
  const location = useMemo(() => readLocation(session?.id), [session?.id, refreshToken, path]);
  const needsLocation = route.section === 'book' && !location?.city;
  const needsAuth = !session && (PRIVATE.includes(route.section) || route.section === 'book');

  // A shared invite link (`/app?ref=NX-…`) is read ONCE, at mount, and then held
  // for the visit: in-app navigation rewrites the URL and drops the query, so
  // reading it per-render would lose the code before the customer ever reaches
  // the booking step that stores it.
  const [referralFromLink] = useState(() => {
    if (typeof window === 'undefined') return '';
    return String(new URLSearchParams(window.location.search).get('ref') || '').trim();
  });

  const body = (() => {
    if (checkingSession) {
      return <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-20 rounded-3xl bg-white/70 animate-pulse" />)}</div>;
    }
    if (route.section === 'auth') {
      return <AuthScreen accentHex={accentHex} mode={authMode} onAuthenticated={onAuthenticated} onContinueAsGuest={() => go('home')} />;
    }
    if (needsAuth) {
      return (
        <div className="space-y-4">
          <div className={`${CARD_CLASS} p-5`}>
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-2xl grid place-items-center text-white shrink-0" style={{ backgroundColor: accentHex }}>
                <Sparkles className="w-5 h-5" />
              </span>
              <div>
                <p className="text-base font-extrabold text-slate-900">Sign in to open your salon account</p>
                <p className={`text-sm mt-1 ${MUTED_CLASS}`}>
                  Your bookings, wallet and notifications are read from your own rows in this project's Supabase — so the app needs to know it is you.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button onClick={() => requireAuth(path)} accentHex={accentHex}>
                Sign in
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setAuthMode('signup');
                  requireAuth(path);
                }}
              >
                Create an account
              </Button>
              <Button variant="ghost" onClick={() => go('home')}>
                Browse salons first
              </Button>
            </div>
          </div>
        </div>
      );
    }
    if (needsLocation) {
      return (
        <div className="space-y-3">
          <div className={`${CARD_CLASS} p-4`}>
            <p className="text-sm font-bold text-slate-900">Where should we book you in?</p>
            <p className={`text-xs mt-1 ${MUTED_CLASS}`}>
              Distance sorting and home-visit availability both need a city. This is the only step before your first booking, and it is saved to your profile
              row.
            </p>
          </div>
          <LocationScreen userId={session?.id} accentHex={accentHex} refreshToken={refreshToken} onDone={() => go('book', route.id)} />
          <Button variant="ghost" onClick={() => go('book', route.id)}>
            Skip for now
          </Button>
        </div>
      );
    }
    switch (route.section) {
      case 'home':
        return (
          <HomeScreen
            userId={session?.id}
            accentHex={accentHex}
            refreshToken={refreshToken}
            onOpenSalon={(id) => go('salon', id)}
            onBook={(id) => go('book', id)}
            onRequireAuth={() => requireAuth(customerPath('profile'))}
            onOpenProfile={() => go('profile')}
          />
        );
      case 'salon':
        return (
          <SalonScreen
            salonId={route.id}
            tab={(route.tab as SalonTab) || 'overview'}
            accentHex={accentHex}
            userId={session?.id}
            refreshToken={refreshToken}
            onBack={() => go('home')}
            onTab={(tab) => go('salon', route.id, tab)}
            onBook={() => go('book', route.id)}
            onRequireAuth={() => requireAuth(customerPath('salon', route.id))}
          />
        );
      case 'book':
        return (
          <BookingFlow
            salonId={route.id}
            userId={session?.id}
            email={session?.email}
            accentHex={accentHex}
            referralCodeFromLink={referralFromLink}
            onRequireAuth={() => requireAuth(customerPath('book', route.id))}
            onOpenBooking={(id) => go('booking', id)}
            onExit={() => (route.id ? go('salon', route.id) : go('home'))}
          />
        );
      case 'bookings':
      case 'booking':
        return (
          <BookingsScreen
            userId={session?.id}
            email={session?.email}
            accentHex={accentHex}
            refreshToken={refreshToken}
            openBookingId={route.section === 'booking' ? route.id : ''}
            onOpenSalon={(id) => go('salon', id)}
            onRequireAuth={() => requireAuth(customerPath('bookings'))}
          />
        );
      case 'wallet':
      case 'qr':
      case 'membership':
      case 'referral':
      case 'offers':
        return (
          <RewardsScreen
            userId={session?.id}
            email={session?.email}
            accentHex={accentHex}
            refreshToken={refreshToken}
            initialTab={route.section === 'qr' ? 'qr' : route.section === 'membership' ? 'membership' : route.section === 'referral' ? 'referral' : route.section === 'offers' ? 'offers' : 'wallet'}
            onOpenSalon={(id) => go('salon', id)}
          />
        );
      case 'notifications':
      case 'favourites':
      case 'reviews':
      case 'data':
        return (
          <ActivityScreen
            userId={session?.id}
            email={session?.email}
            accentHex={accentHex}
            refreshToken={refreshToken}
            initialTab={route.section === 'favourites' || route.section === 'reviews' ? 'favourites' : route.section === 'data' ? 'data' : 'notifications'}
            onOpenSalon={(id) => go('salon', id)}
            onOpenBooking={(id) => go('booking', id)}
          />
        );
      case 'profile':
        return (
          <div className="space-y-4">
            <ProfileScreen userId={session?.id} accentHex={accentHex} refreshToken={refreshToken} onRequireAuth={() => requireAuth(customerPath('profile'))} />
            <div className={`${CARD_CLASS} p-4 flex items-center justify-between gap-3`}>
              <div>
                <p className="text-sm font-bold text-slate-900">{session?.email || 'Signed in'}</p>
                <p className={`text-xs ${MUTED_CLASS}`}>
                  Session from Supabase Auth · id <span className="font-mono">{String(session?.id || '').slice(0, 8)}…</span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => go('location')}>
                  Location
                </Button>
                <Button variant="ghost" onClick={signOut}>
                  <LogOut className="w-4 h-4" /> Sign out
                </Button>
              </div>
            </div>
          </div>
        );
      case 'location':
        return <LocationScreen userId={session?.id} accentHex={accentHex} refreshToken={refreshToken} onDone={() => go('profile')} />;
      default:
        return (
          <HomeScreen
            userId={session?.id}
            accentHex={accentHex}
            refreshToken={refreshToken}
            onOpenSalon={(id) => go('salon', id)}
            onBook={(id) => go('book', id)}
            onRequireAuth={() => requireAuth(customerPath('profile'))}
            onOpenProfile={() => go('profile')}
          />
        );
    }
  })();

  return (
    <div className="min-h-screen bg-slate-50" style={{ backgroundImage: `radial-gradient(1200px 400px at 50% -10%, ${hexToRgba(accentHex, 0.1)}, transparent)` }}>
      <div className="max-w-2xl mx-auto px-4 pt-5 pb-28">
        <header className="flex items-center justify-between gap-3 mb-5">
          <button type="button" onClick={() => go('home')} className="flex items-center gap-2.5 min-w-0 text-left">
            <span className="w-9 h-9 rounded-2xl grid place-items-center text-white shrink-0" style={{ backgroundColor: accentHex }}>
              <Sparkles className="w-5 h-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-extrabold text-slate-900 truncate">{salon?.name || 'Nexora SalonOS'}</span>
              <span className={`block text-[11px] ${MUTED_CLASS}`}>
                {salon?.name ? 'Customer app' : 'Find a salon, book, earn rewards'}
                {location?.city ? ` · ${location.city}` : ''}
              </span>
            </span>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <Chip tone={customerBackendConnected() ? 'success' : 'warn'} title={customerBackendConnected() ? 'The API answered with live Supabase data' : 'No Supabase credentials in this deployment — the app says so instead of showing sample data'}>
              {customerBackendConnected() ? 'supabase' : 'not connected'}
            </Chip>
            {session ? (
              <button type="button" onClick={() => go('profile')} className="w-9 h-9 rounded-full border border-slate-200 bg-white grid place-items-center" title={session.email || 'Your profile'}>
                <User className="w-4 h-4 text-slate-600" />
              </button>
            ) : (
              <Button variant="secondary" onClick={() => requireAuth(path)}>
                Sign in
              </Button>
            )}
          </div>
        </header>

        {tenantSubdomain && route.section === 'home' ? (
          <div className={`${CARD_CLASS} mb-4 p-3.5 flex items-center gap-3`}>
            <span className="w-9 h-9 rounded-2xl grid place-items-center text-white shrink-0" style={{ backgroundColor: accentHex }}>
              <Compass className="w-4 h-4" />
            </span>
            <p className={`text-xs flex-1 ${MUTED_CLASS}`}>
              You arrived from <span className="font-bold text-slate-900">{tenantName || 'this salon'}</span>'s site. Their page is open below — or browse every
              salon on Nexora.
            </p>
            <Button variant="secondary" onClick={() => go('salon', tenantSubdomain)}>
              Open their page
            </Button>
          </div>
        ) : null}

        {body}
      </div>

      <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur" aria-label="Customer app sections">
        <div className="max-w-2xl mx-auto grid grid-cols-5">
          {NAV.map((item) => {
            const active =
              item.section === route.section ||
              (item.section === 'home' && (route.section === 'salon' || route.section === 'book' || route.section === 'location')) ||
              (item.section === 'bookings' && route.section === 'booking') ||
              (item.section === 'wallet' && ['wallet', 'qr', 'membership', 'referral', 'offers'].includes(route.section)) ||
              (item.section === 'notifications' && ['notifications', 'favourites', 'reviews', 'data'].includes(route.section));
            return (
              <button
                key={item.section}
                type="button"
                onClick={() => go(item.section)}
                className={`py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-bold transition ${active ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <span style={active ? { color: accentHex } : undefined}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

/**
 * The salon's own theme colour, taken from the same accent palette the owner's
 * editor writes (`profiles.theme_accent_key` → src/themeAccents.ts). A customer
 * app opened through a salon subdomain therefore wears that salon's brand
 * without a second source of truth for what "the brand colour" means; an unknown
 * key falls back to the product default rather than to slate.
 */
export const DEFAULT_ACCENT = '#C20E5A';

export function accentFrom(salon: CustomerSalon | null): string {
  const key = String(salon?.themeAccentKey || '') as AccentPaletteKey;
  const palette = ACCENT_PALETTES[key];
  return palette?.primaryHex || DEFAULT_ACCENT;
}

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return `rgba(194, 14, 90, ${alpha})`;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
