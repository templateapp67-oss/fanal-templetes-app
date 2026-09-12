import React, { useEffect, useRef, useState } from 'react';
import {
  Banknote,
  Bell,
  ChevronDown,
  CircleUserRound,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogOut,
  Megaphone,
  Medal,
  Menu,
  Percent,
  Settings,
  Ticket,
  Trophy,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  GrowthPartnerSection,
  PartnerPortalSection,
  partnerPortalPath,
} from '../lib/router';
import { PARTNER_ACTIVITY_LABELS, type PartnerActivityEntry } from '../lib/growthPartner';
import { PartnerBrandMark } from './PartnerPortalLogin';
import { formatPartnerDate } from './GrowthPartnerSections';

/**
 * Partner portal shell (Part 2.2) — the professional dashboard frame for
 * `/partner/*`: a fixed sidebar + sticky top header + main content on desktop,
 * and a collapsible navigation drawer (hamburger button, backdrop, Escape to
 * close) on mobile.
 *
 * The sidebar menu is data-driven from two registries so the portal can grow
 * (Earnings, Commission, Withdrawals, Marketing Materials, Partner Levels,
 * Leaderboards, Notifications, Support) by adding entries — no redesign:
 *
 *   - PARTNER_PORTAL_NAV       live menu items (navigable sections)
 *   - PARTNER_PORTAL_PLANNED   future modules, shown disabled with a "Soon"
 *                              badge until their backend module is real
 *
 * Rendered only after the authorization gate reaches `ready` (authenticated
 * ACTIVE partner) — the shell itself never decides authorization.
 */

/** Live sidebar entry: a real, navigable portal section. */
export interface PartnerPortalNavItem {
  section: PartnerPortalSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** Sidebar menu items, in menu order. Mirrors PARTNER_PORTAL_MENU_SECTIONS. */
export const PARTNER_PORTAL_NAV: PartnerPortalNavItem[] = [
  { section: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { section: 'referral-code', label: 'My Referral Code', icon: Ticket },
  { section: 'referred-users', label: 'Referred Users', icon: Users },
  { section: 'referral-status', label: 'Referral Status', icon: ListChecks },
  { section: 'profile', label: 'Profile', icon: CircleUserRound },
];

/**
 * Future portal modules, shown disabled with a "Soon" badge. Each entry is a
 * slot for a real module that does not exist yet (no commission model, no
 * payouts, …) — rendering them as enabled would be fake, so they navigate
 * nowhere until the section lands in the router and this registry moves.
 */
export interface PartnerPortalPlannedItem {
  /** Stable id for the future section (becomes its route segment). */
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** Planned modules — add new sidebar sections here first, then promote them. */
export const PARTNER_PORTAL_PLANNED: PartnerPortalPlannedItem[] = [
  { id: 'earnings', label: 'Earnings', icon: Wallet },
  { id: 'commission', label: 'Commission', icon: Percent },
  { id: 'withdrawals', label: 'Withdrawals', icon: Banknote },
  { id: 'marketing-materials', label: 'Marketing Materials', icon: Megaphone },
  { id: 'partner-levels', label: 'Partner Levels', icon: Medal },
  { id: 'leaderboards', label: 'Leaderboards', icon: Trophy },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'support', label: 'Support', icon: LifeBuoy },
];

/** Human title for each portal section (header + drawer use it). */
export const PARTNER_PORTAL_SECTION_TITLES: Record<PartnerPortalSection, string> = {
  dashboard: 'Dashboard',
  'referral-code': 'My Referral Code',
  'referred-users': 'Referred Users',
  'referral-status': 'Referral Status',
  profile: 'Profile',
  performance: 'Performance',
  commission: 'Commission',
};

/**
 * Portal section → the content section rendered inside the shell. The portal
 * reuses the real area components: `referred-users` renders the plain
 * referrals roll, `referral-status` renders the filterable/searchable list,
 * and `referral-code` renders the dedicated code+share-link section. Adding a
 * new portal page = one entry here plus one renderer case in the page.
 */
const PARTNER_PORTAL_CONTENT: Record<PartnerPortalSection, GrowthPartnerSection | 'referral-code'> = {
  dashboard: 'dashboard',
  'referral-code': 'referral-code',
  'referred-users': 'referrals',
  'referral-status': 'customers',
  profile: 'profile',
  performance: 'performance',
  commission: 'commission',
};

/** Resolve the content to render for a portal section (see PARTNER_PORTAL_CONTENT). */
export function partnerPortalContentSection(
  section: PartnerPortalSection
): GrowthPartnerSection | 'referral-code' {
  return PARTNER_PORTAL_CONTENT[section] ?? 'dashboard';
}

/**
 * Compact display form of the partner id (the growth_partners.user_id the
 * backend scopes every read to). The full id stays available in the `title`
 * tooltip and the profile menu — this is display formatting only.
 */
export function shortPartnerId(id: string | null | undefined): string {
  const value = typeof id === 'string' ? id.trim() : '';
  if (!value) return '';
  if (value.length <= 13) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/**
 * Profile dropdown (Part 2.3). The user card shows the partner's real
 * identity: name, email and the full partner id. "My Profile" navigates to
 * the portal profile section; "Account Settings" is a planned slot (no
 * account-settings module exists yet — it is shown disabled with a Soon
 * badge, exactly like the sidebar's planned modules, never as a fake link);
 * Logout runs the real sign-out.
 */
export const PartnerProfileMenu: React.FC<{
  displayName: string;
  email: string;
  partnerId?: string;
  onNavigateProfile: () => void;
  onLogout: () => void;
}> = ({ displayName, email, partnerId, onNavigateProfile, onLogout }) => (
  <div data-partner-profile-menu>
    <div className="border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white"
          style={{ backgroundColor: '#0f172a' }}
        >
          {displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold text-slate-900">{displayName}</p>
          <p className="truncate text-xs text-slate-500" title={email}>
            {email}
          </p>
        </div>
      </div>
      {partnerId ? (
        <p
          className="mt-2.5 break-all font-mono text-[11px] leading-relaxed text-slate-500"
          title="Partner ID"
        >
          Partner ID: {partnerId}
        </p>
      ) : null}
    </div>
    <div className="p-2" role="none">
      <button
        type="button"
        role="menuitem"
        data-partner-menu-item="profile"
        onClick={onNavigateProfile}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900"
      >
        <CircleUserRound className="h-4 w-4 shrink-0 text-slate-400" />
        My Profile
      </button>
      <span
        role="menuitem"
        aria-disabled="true"
        data-partner-menu-item="account-settings"
        title="Coming soon"
        className="flex w-full cursor-default items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400"
      >
        <Settings className="h-4 w-4 shrink-0" />
        Account Settings
        <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          Soon
        </span>
      </span>
      <div className="my-1.5 border-t border-slate-100" role="separator" />
      <button
        type="button"
        role="menuitem"
        data-partner-logout
        onClick={onLogout}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-600"
      >
        <LogOut className="h-4 w-4 shrink-0 text-slate-400" />
        Logout
      </button>
    </div>
  </div>
);

/**
 * Notifications dropdown (Part 2.3). There is no notifications backend yet,
 * so the panel shows what is REAL today: the recent-activity feed from
 * `get_my_partner_dashboard` (referral added / website started / completed).
 * Empty and loading states are honest — no invented notification counts, no
 * unread badges (nothing tracks read state).
 */
export const PartnerNotificationsPanel: React.FC<{
  entries: PartnerActivityEntry[];
  loading?: boolean;
}> = ({ entries, loading = false }) => (
  <div data-partner-notifications-panel>
    <div className="border-b border-slate-100 px-4 py-3">
      <p className="text-sm font-bold text-slate-900">Notifications</p>
      <p className="text-xs text-slate-500">Recent activity from your referrals</p>
    </div>
    <div className="max-h-80 overflow-y-auto p-2">
      {entries.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-sm font-bold text-slate-700">
            {loading ? 'Loading your notifications…' : 'No notifications yet'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {loading
              ? 'Your recent referral activity is on its way.'
              : 'Activity from your referrals will appear here.'}
          </p>
        </div>
      ) : (
        <ul aria-label="Recent notifications">
          {entries.map((entry, index) => (
            <li
              key={`${entry.type}-${entry.ref}-${index}`}
              className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50"
            >
              <span
                aria-hidden="true"
                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: '#0f172a' }}
              />
              <div className="min-w-0 leading-tight">
                <p className="text-sm font-semibold text-slate-900">
                  {(PARTNER_ACTIVITY_LABELS as Record<string, string>)[entry.type] ?? 'Referral update'}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {(entry.display_name || '').trim() || `Referred user ${entry.ref}`} ·{' '}
                  {formatPartnerDate(entry.at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  </div>
);

const NAV_ITEM_CLASS = 'flex items-center gap-3 w-full rounded-xl px-3.5 py-2.5 text-sm font-bold transition-colors cursor-pointer';

/** One live nav button (used by both the desktop sidebar and the drawer). */
const PartnerPortalNavButton: React.FC<{
  item: PartnerPortalNavItem;
  active: boolean;
  accentHex: string;
  onSelect: () => void;
}> = ({ item, active, accentHex, onSelect }) => {
  const Icon = item.icon;
  return (
    <button
      type="button"
      data-partner-nav={item.section}
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={`${NAV_ITEM_CLASS} ${
        active ? 'text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
      style={active ? { backgroundColor: accentHex } : undefined}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  );
};

/** One planned (not-yet-real) nav entry — visible slot, never a fake link. */
const PartnerPortalPlannedButton: React.FC<{ item: PartnerPortalPlannedItem }> = ({ item }) => {
  const Icon = item.icon;
  return (
    <span
      data-partner-planned={item.id}
      title="Coming soon"
      className="flex items-center gap-3 w-full rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-400 cursor-default"
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{item.label}</span>
      <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        Soon
      </span>
    </span>
  );
};

/** The shared sidebar/drawer navigation content (live items + planned + logout). */
const PartnerPortalNavList: React.FC<{
  section: PartnerPortalSection;
  accentHex: string;
  email: string;
  onSelect: (section: PartnerPortalSection) => void;
  onLogout: () => void;
}> = ({ section, accentHex, email, onSelect, onLogout }) => (
  <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 pb-4">
    <p className="px-3.5 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
      Menu
    </p>
    {PARTNER_PORTAL_NAV.map((item) => (
      <PartnerPortalNavButton
        key={item.section}
        item={item}
        active={item.section === section}
        accentHex={accentHex}
        onSelect={() => onSelect(item.section)}
      />
    ))}
    <p className="px-3.5 pt-5 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
      Coming soon
    </p>
    {PARTNER_PORTAL_PLANNED.map((item) => (
      <PartnerPortalPlannedButton key={item.id} item={item} />
    ))}
    <div className="mt-auto border-t border-slate-100 pt-3">
      <button
        type="button"
        data-partner-logout
        onClick={onLogout}
        className={`${NAV_ITEM_CLASS} text-slate-600 hover:bg-rose-50 hover:text-rose-600`}
      >
        <LogOut className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">Logout</span>
      </button>
      <p className="mt-2 truncate px-3.5 text-xs text-slate-400" title={email}>
        {email}
      </p>
    </div>
  </div>
);

/**
 * The dashboard shell. Responsive without JavaScript on desktop (CSS
 * sidebar); JavaScript only drives the mobile drawer (open/close, backdrop,
 * Escape key) — navigation works whether or not the drawer ever opens.
 */
export const PartnerPortalShell: React.FC<{
  /** Active portal section (drives the highlighted menu item + header title). */
  section: PartnerPortalSection;
  displayName: string;
  email: string;
  /** The partner's growth_partners.user_id — displayed as the Partner ID. */
  partnerId?: string;
  /**
   * Recent referral activity for the notifications dropdown (from
   * get_my_partner_dashboard — the only real activity source today).
   */
  notifications?: PartnerActivityEntry[];
  notificationsLoading?: boolean;
  navigate: (to: string) => void;
  onLogout: () => void;
  accentHex?: string;
  children?: React.ReactNode;
}> = ({
  section,
  displayName,
  email,
  partnerId,
  notifications = [],
  notificationsLoading = false,
  navigate,
  onLogout,
  accentHex = '#C20E5A',
  children,
}) => {
  const [navOpen, setNavOpen] = useState(false);
  /** Which header dropdown is open (profile / notifications), if any. */
  const [openMenu, setOpenMenu] = useState<'profile' | 'notifications' | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // Selecting a section navigates the SPA and closes the drawer (mobile).
  const selectSection = (next: PartnerPortalSection) => {
    setNavOpen(false);
    navigate(partnerPortalPath(next));
  };

  const menusOpen = openMenu !== null;
  const toggleMenu = (menu: 'profile' | 'notifications') =>
    setOpenMenu((current) => (current === menu ? null : menu));

  // Escape closes the open drawer and the open dropdown (keyboard users get
  // the same affordance as a click on the backdrop).
  useEffect(() => {
    if (!navOpen && !menusOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavOpen(false);
        setOpenMenu(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    // Lock background scroll while the drawer is open (mobile polish).
    const previousOverflow = document.body.style.overflow;
    if (navOpen) document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [navOpen, menusOpen]);

  // Move focus into the drawer when it opens so keyboard/AT users land inside.
  useEffect(() => {
    if (navOpen) drawerRef.current?.focus();
  }, [navOpen]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar (fixed; lg+). */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <PartnerBrandMark />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-extrabold text-slate-900">Nexora</p>
            <p className="truncate text-xs font-semibold text-slate-500">Growth Partner</p>
          </div>
        </div>
        <PartnerPortalNavList
          section={section}
          accentHex={accentHex}
          email={email}
          onSelect={selectSection}
          onLogout={onLogout}
        />
      </aside>

      {/* Mobile drawer + backdrop (below lg). */}
      {navOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          data-partner-nav-backdrop
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
        />
      ) : null}
      <div
        ref={drawerRef}
        tabIndex={-1}
        id="partner-portal-drawer"
        data-partner-drawer
        aria-label="Growth Partner navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl outline-none transition-[transform,visibility] duration-200 lg:hidden ${
          navOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <PartnerBrandMark />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-extrabold text-slate-900">Nexora</p>
              <p className="truncate text-xs font-semibold text-slate-500">Growth Partner</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            data-partner-nav-close
            onClick={() => setNavOpen(false)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <PartnerPortalNavList
          section={section}
          accentHex={accentHex}
          email={email}
          onSelect={selectSection}
          onLogout={onLogout}
        />
      </div>

      {/* Content column (offset by the sidebar width on lg+). */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          {/* Click-catcher behind an open dropdown. It sits below the header
              (z-20) so the panels — children of the z-30 header — stay
              clickable above it, while any click on the page closes the menu. */}
          {openMenu ? (
            <button
              type="button"
              aria-label="Close menu"
              data-partner-menu-backdrop
              onClick={() => setOpenMenu(null)}
              className="fixed inset-0 z-20 cursor-default"
            />
          ) : null}
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              aria-controls="partner-portal-drawer"
              data-partner-nav-toggle
              onClick={() => setNavOpen((open) => !open)}
              className="shrink-0 rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* Mobile: the logo lives in the header (the sidebar is hidden). */}
            <div
              className="flex shrink-0 items-center gap-2 lg:hidden"
              data-partner-mobile-logo
            >
              <PartnerBrandMark />
              <span className="text-sm font-extrabold text-slate-900">Nexora</span>
            </div>
            {/* Page title (sm+; on phones the header stays to logo + actions). */}
            <div className="hidden min-w-0 flex-1 sm:block">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Growth Partner
              </p>
              <h1 className="truncate text-lg font-extrabold leading-tight text-slate-900">
                {PARTNER_PORTAL_SECTION_TITLES[section]}
              </h1>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
              {/* Notifications (real recent-activity feed; honest empty state). */}
              <div className="relative">
                <button
                  type="button"
                  aria-label="Notifications"
                  aria-expanded={openMenu === 'notifications'}
                  aria-controls="partner-notifications-panel"
                  data-partner-notifications
                  onClick={() => toggleMenu('notifications')}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Bell className="h-5 w-5" />
                </button>
                {openMenu === 'notifications' ? (
                  <div
                    id="partner-notifications-panel"
                    className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[92vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
                  >
                    <PartnerNotificationsPanel
                      entries={notifications}
                      loading={notificationsLoading}
                    />
                  </div>
                ) : null}
              </div>
              {/* Profile: avatar + partner name + partner id, opens the
                  profile dropdown (My Profile / Account Settings / Logout). */}
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'profile'}
                  aria-controls="partner-profile-menu"
                  data-partner-profile-button
                  onClick={() => toggleMenu('profile')}
                  className="flex min-w-0 items-center gap-2 rounded-xl p-1.5 text-left hover:bg-slate-100"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white"
                    style={{ backgroundColor: accentHex }}
                  >
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden min-w-0 leading-tight sm:block">
                    <span className="block truncate text-sm font-bold text-slate-900">
                      {displayName}
                    </span>
                    {partnerId ? (
                      <span
                        className="block truncate font-mono text-[11px] text-slate-500"
                        title={`Partner ID: ${partnerId}`}
                      >
                        ID {shortPartnerId(partnerId)}
                      </span>
                    ) : (
                      <span className="block truncate text-xs text-slate-500">{email}</span>
                    )}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                      openMenu === 'profile' ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {openMenu === 'profile' ? (
                  <div
                    id="partner-profile-menu"
                    role="menu"
                    aria-label="Profile menu"
                    className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[92vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
                  >
                    <PartnerProfileMenu
                      displayName={displayName}
                      email={email}
                      partnerId={partnerId}
                      onNavigateProfile={() => {
                        setOpenMenu(null);
                        navigate(partnerPortalPath('profile'));
                      }}
                      onLogout={() => {
                        setOpenMenu(null);
                        onLogout();
                      }}
                    />
                  </div>
                ) : null}
              </div>
              {/* Quick logout (sm+; phones use the profile dropdown). */}
              <button
                type="button"
                title="Logout"
                aria-label="Logout"
                data-partner-logout
                onClick={onLogout}
                className="hidden rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 sm:block"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>
        <main id="partner-portal-main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
};
