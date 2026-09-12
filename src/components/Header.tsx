import React, { useEffect, useState } from 'react';
import { AppView, SalonProfile } from '../types';
import { PartnerProfileModal } from './PartnerProfileModal';
import { NotificationBell } from './NotificationBell';
import { AuthModal } from './AuthModal';
import { supabase } from '../lib/supabaseClient';

interface HeaderProps {
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  salonName: string;
  onBuildWebsiteClick?: () => void;
  user: any;
  setUser: (user: any) => void;
  profile: SalonProfile;
  onProfileSaved: (patch: Partial<SalonProfile>) => void;
  openAuth: (mode: 'login' | 'signup') => void;
}

// ---------------------------------------------------------------------------
// The view switcher.
//
// One list feeds both the desktop pill row and the mobile menu, so a new
// surface is added in exactly one place and shows up at every screen size.
// `activeViews` lists the views in which an entry counts as the current one
// (e.g. the staff dashboards belong to "SaaS Dashboard").
// ---------------------------------------------------------------------------
export interface HeaderNavEntry {
  /** View this entry switches to. */
  view: AppView;
  label: string;
  /** Material Symbols ligature. */
  icon: string;
  activeViews: AppView[];
  /** Optional trailing badge, e.g. the "Live" chip on Explore Templates. */
  badge?: string;
}

export const HEADER_NAV_ENTRIES: HeaderNavEntry[] = [
  { view: 'landing', label: 'Home', icon: 'home', activeViews: ['landing'] },
  {
    view: 'wizard',
    label: 'Explore Templates',
    icon: 'devices',
    activeViews: ['preview', 'wizard'],
    badge: 'Live',
  },
  {
    view: 'dashboard',
    label: 'SaaS Dashboard',
    icon: 'dashboard',
    activeViews: ['dashboard', 'staffPerformance', 'staffCommission'],
  },
  // Growth Partner area — `/growth-partner`. Same routing as every other entry:
  // `setCurrentView('growthPartner')` pushes the route, and the page itself
  // decides sign-in / partner-only / ready, so the entry is safe to show to
  // every visitor.
  {
    view: 'growthPartner',
    label: 'Growth Partner',
    icon: 'handshake',
    activeViews: ['growthPartner'],
  },
  { view: 'bookings', label: 'My Bookings', icon: 'event_available', activeViews: ['bookings'] },
];

export function isHeaderNavEntryActive(entry: HeaderNavEntry, currentView: AppView): boolean {
  return entry.activeViews.includes(currentView);
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  setCurrentView,
  salonName,
  onBuildWebsiteClick,
  user,
  setUser,
  profile,
  openAuth,
  onProfileSaved,
}) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // The menu is an overlay on top of the page, so Escape has to close it —
  // there is no backdrop element to click away on.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  /** One handler for both layouts; the mobile menu closes after the switch. */
  const openNavEntry = (entry: HeaderNavEntry) => {
    setMobileNavOpen(false);
    if (entry.view === 'wizard' && onBuildWebsiteClick) {
      onBuildWebsiteClick();
      return;
    }
    setCurrentView(entry.view);
  };

  return (
    <header className="bg-surface/80 backdrop-blur-md fixed top-0 w-full z-50 border-b border-outline-variant/30 transition-all duration-300" id="global-nav">
      <div className="flex justify-between items-center px-margin-mobile md:px-gutter max-w-container-max mx-auto h-20">
        {/* Brand */}
        <div 
          onClick={() => setCurrentView('landing')}
          className="flex items-center gap-base cursor-pointer group"
        >
          <img alt="Nexora Logo" className="w-8 h-8 object-contain" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDJYocRxmo4vpJ1_AiSXtAMUVqSgd5cKajB-4RUxdyE8aRIhXYKc6rpkP2QfQk08sdDXrCP9Xpc0FsS9TCBIXdCIvQsKMtaXaNapgbxpoP6ZtqwDgiKttI_L1wi-DCFFUdw5zFns1eezsmbwoXe7dlwdAN6mudQV7w2QZhWcRTvgOfjdEndslxxaWrRhgFdVl0nFcwkXUBL3dISegAZ9Wpv-_iyNsyPYyyAeFelbPvSjMco5lgCDlptw6yYIDX8QK0hSWM"/>
          <span className="material-symbols-outlined text-[#C20E5A]" style={{ fontVariationSettings: "'FILL' 1" }}>spa</span>
          <span className="font-display-lg text-display-lg-mobile tracking-tighter text-[#C20E5A]">Nexora</span>
        </div>

        {/* View Switcher Navigation (lg and up) */}
        {/* The row scrolls sideways (scrollbar hidden) instead of overflowing the
            header, so every entry stays reachable at the `lg` breakpoint. Below
            `lg` the same entries live in the menu behind the button on the
            right, since a pill row of five does not fit next to the brand. */}
        <nav className="hidden lg:flex items-center gap-1 bg-surface-variant/30 p-1 rounded-full border border-outline-variant/30 min-w-0 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {HEADER_NAV_ENTRIES.map((entry) => {
            const active = isHeaderNavEntryActive(entry, currentView);
            return (
              <button
                key={entry.view}
                onClick={() => openNavEntry(entry)}
                aria-current={active ? 'page' : undefined}
                className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  active
                    ? 'bg-[#C20E5A] text-white shadow-sm'
                    : 'text-on-surface-variant hover:text-[#C20E5A]'
                }`}
              >
                <span className="material-symbols-outlined text-base">{entry.icon}</span>
                <span>{entry.label}</span>
                {entry.badge && (
                  <span className="text-[10px] bg-amber-400 text-slate-950 font-bold px-1.5 py-0.2 rounded-full">
                    {entry.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <NotificationBell userEmail={user?.email || ""} />
          
          {user ? (
            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-0.5">Nexora Partner</span>
                <span className="text-sm font-bold text-[#C20E5A]">
                  {profile.ownerName || user.user_metadata?.full_name || 'Owner'}
                </span>
              </div>
              <button
                onClick={() => setProfileOpen(true)}
                className="w-10 h-10 rounded-full overflow-hidden border border-pink-200"
                aria-label="User Profile Settings" title="User Profile Settings"
              >
                {profile.ownerPhotoUrl ? <img src={profile.ownerPhotoUrl} alt="Your profile" className="w-full h-full object-cover" /> : <span>Profile</span>}
              </button>
              <button
                onClick={handleLogout}
                className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all group"
                title="Logout"
              >
                <span className="material-symbols-outlined text-xl group-hover:scale-110 transition-transform">logout</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => openAuth('login')}
                className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-[#C20E5A] transition-colors"
              >
                Log In
              </button>
              <button
                onClick={() => openAuth('signup')}
                className="px-6 py-2 bg-[#C20E5A] text-white rounded-full text-sm font-bold shadow-lg shadow-[#C20E5A]/20 hover:bg-[#A30B4A] hover:-translate-y-0.5 transition-all active:scale-95"
              >
                Sign Up
              </button>
            </div>
          )}

          {/* Mobile menu trigger (below `lg`). */}
          <button
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-expanded={mobileNavOpen}
            aria-controls="global-nav-mobile"
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            title={mobileNavOpen ? 'Close menu' : 'Menu'}
            className="lg:hidden w-10 h-10 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:text-[#C20E5A] hover:bg-pink-50 transition-all"
          >
            <span className="material-symbols-outlined text-xl">{mobileNavOpen ? 'close' : 'menu'}</span>
          </button>
        </div>
      </div>

      {/* Mobile menu (below `lg`). Kept mounted and toggled with `hidden` so the
          entries exist in the markup at every width; `display: none` also keeps
          them out of the accessibility tree while closed. */}
      <div
        id="global-nav-mobile"
        className={`lg:hidden absolute left-0 top-20 w-full border-b border-outline-variant/30 bg-surface/95 backdrop-blur-md shadow-xl ${
          mobileNavOpen ? 'block' : 'hidden'
        }`}
      >
        <nav className="flex flex-col gap-1 p-4" aria-label="Main navigation">
          {HEADER_NAV_ENTRIES.map((entry) => {
            const active = isHeaderNavEntryActive(entry, currentView);
            return (
              <button
                key={entry.view}
                onClick={() => openNavEntry(entry)}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-left transition-colors ${
                  active
                    ? 'bg-[#C20E5A] text-white shadow-sm'
                    : 'text-on-surface-variant hover:bg-surface-variant/60 hover:text-[#C20E5A]'
                }`}
              >
                <span className="material-symbols-outlined text-lg">{entry.icon}</span>
                <span>{entry.label}</span>
                {entry.badge && (
                  <span className="text-[10px] bg-amber-400 text-slate-950 font-bold px-1.5 py-0.2 rounded-full">
                    {entry.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
      {profileOpen && <PartnerProfileModal editable profile={profile} onSaved={onProfileSaved} onClose={() => setProfileOpen(false)} />}
    </header>
  );
};
