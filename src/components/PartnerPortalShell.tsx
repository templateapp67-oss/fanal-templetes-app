import React, { useEffect, useRef, useState } from 'react';
import {
  Banknote,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  FileSpreadsheet,
  Gift,
  Home,
  LayoutDashboard,
  LifeBuoy,
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
import { formatPartnerDate } from '../lib/partnerPresentation';

/**
 * Partner portal shell (Part 2.2) — the professional dashboard frame for
 * `/partner/*`: a fixed sidebar + sticky top header + main content on desktop,
 * and a collapsible navigation drawer (hamburger button, backdrop, Escape to
 * close) on mobile.
 *
 * The sidebar menu is data-driven from ONE registry so the portal grows by
 * adding an entry — no redesign:
 *
 *   - PARTNER_PORTAL_NAV       live menu items (navigable sections)
 *
 * PART 3: the seven modules that used to sit in a disabled planned registry
 * behind its own greyed-out heading (Earnings, Withdrawals, Marketing
 * Materials, Partner Levels, Leaderboards, Notifications, Support) are live
 * entries here — the planned registry and its badge are deleted. Each one renders as a real
 * anchor carrying its canonical `/partner/...` URL: a plain click stays inside
 * the SPA (history.pushState through the app's navigate), while middle-click,
 * ⌘/Ctrl-click and "copy link address" keep working like any link. A menu entry
 * with no page behind it is a bug, never a placeholder.
 *
 * Rendered only after the authorization gate reaches `ready` (authenticated
 * ACTIVE partner) — the shell itself never decides authorization.
 */

/** Which sidebar group an entry belongs to (the small uppercase headings). */
export type PartnerPortalNavGroup = 'portal' | 'earnings' | 'resources' | 'account';

/** Sidebar group headings, in menu order. Every group label shown in the nav. */
export const PARTNER_PORTAL_NAV_GROUPS: Array<{ id: PartnerPortalNavGroup; label: string }> = [
  { id: 'portal', label: 'Menu' },
  { id: 'earnings', label: 'Earnings & growth' },
  { id: 'resources', label: 'Resources' },
  { id: 'account', label: 'Account' },
];

/** Live sidebar entry: a real, navigable portal section. */
export interface PartnerPortalNavItem {
  section: PartnerPortalSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: PartnerPortalNavGroup;
}

/** Sidebar menu items, in menu order. Mirrors PARTNER_PORTAL_MENU_SECTIONS. */
export const PARTNER_PORTAL_NAV: PartnerPortalNavItem[] = [
  { section: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'portal' },
  { section: 'referral-code', label: 'My Referral Code', icon: Ticket, group: 'portal' },
  { section: 'referred-users', label: 'Referred Users', icon: Users, group: 'portal' },
  { section: 'referral-status', label: 'Referral Status', icon: FileSpreadsheet, group: 'portal' },
  { section: 'rewards', label: 'Rewards', icon: Gift, group: 'earnings' },
  { section: 'commission', label: 'Extra Onboarding Reward', icon: Percent, group: 'earnings' },
  { section: 'earnings', label: 'Earnings', icon: Wallet, group: 'earnings' },
  { section: 'withdrawals', label: 'Withdrawals', icon: Banknote, group: 'earnings' },
  { section: 'partner-levels', label: 'Partner Levels', icon: Medal, group: 'earnings' },
  { section: 'leaderboards', label: 'Leaderboards', icon: Trophy, group: 'earnings' },
  { section: 'marketing-materials', label: 'Marketing Materials', icon: Megaphone, group: 'resources' },
  { section: 'notifications', label: 'Notifications', icon: Bell, group: 'resources' },
  { section: 'support', label: 'Support', icon: LifeBuoy, group: 'resources' },
  { section: 'profile', label: 'Profile', icon: CircleUserRound, group: 'account' },
  // Account Settings is a real page (/partner/account-settings) — the profile
  // dropdown opens it and the sidebar carries it in the Account group.
  { section: 'account-settings', label: 'Account Settings', icon: Settings, group: 'account' },
  { section: 'diagnostics', label: 'Session & Audit Diagnostics', icon: Settings, group: 'account' },
];

/** Human title for each portal section (header + drawer use it). */
export const PARTNER_PORTAL_SECTION_TITLES: Record<PartnerPortalSection, string> = {
  dashboard: 'Dashboard',
  'referral-code': 'My Referral Code',
  'referred-users': 'Referred Users',
  'referral-status': 'Referral Status',
  profile: 'Profile',
  'account-settings': 'Account Settings',
  diagnostics: 'Session & Audit Diagnostics',
  rewards: 'Rewards',
  performance: 'Performance',
  commission: 'Extra Onboarding Reward',
  earnings: 'Earnings',
  withdrawals: 'Withdrawals',
  'marketing-materials': 'Marketing Materials',
  'partner-levels': 'Partner Levels',
  leaderboards: 'Leaderboards',
  notifications: 'Notifications',
  support: 'Support',
};

/**
 * Portal section → the content section rendered inside the shell. The portal
 * reuses the real area components: `referred-users` renders the plain
 * referrals roll, `referral-status` renders the filterable/searchable list,
 * and `referral-code` renders the dedicated code+share-link section. Adding a
 * new portal page = one entry here plus one renderer case in the page.
 */
const PARTNER_PORTAL_CONTENT: Record<PartnerPortalSection, GrowthPartnerSection | 'referral-code' | 'rewards' | PartnerPortalSection> = {
  dashboard: 'dashboard',
  'referral-code': 'referral-code',
  'referred-users': 'referrals',
  'referral-status': 'customers',
  profile: 'profile',
  'account-settings': 'account-settings',
  diagnostics: 'diagnostics',
  rewards: 'rewards',
  performance: 'performance',
  commission: 'commission',
  earnings: 'earnings', withdrawals: 'withdrawals', 'marketing-materials': 'marketing-materials',
  'partner-levels': 'partner-levels', leaderboards: 'leaderboards', notifications: 'notifications', support: 'support',
};

/** Resolve the content to render for a portal section (see PARTNER_PORTAL_CONTENT). */
export function partnerPortalContentSection(
  section: PartnerPortalSection
): GrowthPartnerSection | 'referral-code' | 'rewards' | PartnerPortalSection {
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
 * the portal profile section; "Account Settings" opens the real
 * /partner/account-settings page (email, password, 2FA, sessions, danger
 * zone); Logout runs the real sign-out.
 */
export const PartnerProfileMenu: React.FC<{
  displayName: string;
  email: string;
  partnerId?: string;
  avatarUrl?: string;
  onNavigateProfile: () => void;
  onNavigateAccountSettings?: () => void;
  onLogout: () => void;
}> = ({ displayName, email, partnerId, avatarUrl, onNavigateProfile, onNavigateAccountSettings, onLogout }) => (
  <div data-partner-profile-menu>
    <div className="border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-3">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="Profile"
            className="h-10 w-10 shrink-0 rounded-full object-cover border border-slate-200"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white"
            style={{ backgroundColor: '#0f172a' }}
          >
            {displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
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
      <button
        type="button"
        role="menuitem"
        data-partner-menu-item="account-settings"
        onClick={onNavigateAccountSettings}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900"
      >
        <Settings className="h-4 w-4 shrink-0 text-slate-400" />
        Account Settings
      </button>
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
 * Notifications dropdown (Part 2.3). The panel is deliberately a PEEK at the
 * recent-activity feed from `get_my_partner_dashboard` (referral added /
 * website started / completed) — the rows that come with it. It shows nothing
 * else, because the dropdown does not track read state: the real notification
 * rows, their unread count and the mark-as-read control live in
 * `/partner/notifications`, which the footer link below hands off to. Empty and
 * loading states are honest — no invented notification counts, no unread badge
 * this panel cannot back up.
 */
export const PartnerNotificationsPanel: React.FC<{
  entries: PartnerActivityEntry[];
  loading?: boolean;
  /** Opens the full Notifications section; the panel itself never paginates. */
  onOpenAll?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}> = ({ entries, loading = false, onOpenAll }) => (
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
    {onOpenAll ? (
      <div className="border-t border-slate-100 p-2">
        <a
          href={partnerPortalPath('notifications')}
          onClick={onOpenAll}
          data-partner-notifications-open-all
          className="flex min-h-10 items-center justify-between gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          All notifications
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    ) : null}
  </div>
);

const NAV_ITEM_CLASS = 'flex items-center gap-3 w-full rounded-xl px-3.5 py-2.5 text-sm font-bold transition-colors cursor-pointer';

/**
 * One live nav entry (used by both the desktop sidebar and the mobile drawer).
 *
 * An `<a href>` rather than a button, because every item now names a real
 * route: the URL is visible before the click, the link can be opened in a new
 * tab or copied, and the browser's own semantics apply. Plain left clicks are
 * intercepted and handed to the SPA's navigate(), so nothing reloads; modified
 * clicks are deliberately left to the browser.
 */
const PartnerPortalNavButton: React.FC<{
  item: PartnerPortalNavItem;
  active: boolean;
  accentHex: string;
  onSelect: () => void;
}> = ({ item, active, accentHex, onSelect }) => {
  const Icon = item.icon;
  return (
    <a
      href={partnerPortalPath(item.section)}
      data-partner-nav={item.section}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onSelect();
      }}
      className={`${NAV_ITEM_CLASS} ${
        active ? 'text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
      style={active ? { backgroundColor: accentHex } : undefined}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{item.label}</span>
    </a>
  );
};

/**
 * The shared sidebar/drawer navigation content. Entries are grouped by the
 * registry's `group` field, and a group heading only renders when the group
 * actually has an entry — an empty heading is a bug the registry could
 * otherwise introduce on its own.
 */
const PartnerPortalNavList: React.FC<{
  section: PartnerPortalSection;
  accentHex: string;
  email: string;
  onSelect: (section: PartnerPortalSection) => void;
  onHome: () => void;
  onLogout: () => void;
}> = ({ section, accentHex, email, onSelect, onHome, onLogout }) => (
  <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
    {PARTNER_PORTAL_NAV_GROUPS.map((group) => {
      const items = PARTNER_PORTAL_NAV.filter((item) => item.group === group.id);
      if (!items.length) return null;
      return (
        <React.Fragment key={group.id}>
          <p data-partner-nav-group={group.id} className="px-3.5 pt-5 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {group.label}
          </p>
          {items.map((item) => (
            <PartnerPortalNavButton
              key={item.section}
              item={item}
              active={item.section === section}
              accentHex={accentHex}
              onSelect={() => onSelect(item.section)}
            />
          ))}
        </React.Fragment>
      );
    })}
    <div className="mt-auto border-t border-slate-100 pt-3">
      <button
        type="button"
        data-partner-home
        onClick={onHome}
        className={`${NAV_ITEM_CLASS} text-slate-600 hover:bg-slate-100 hover:text-slate-900`}
      >
        <Home className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">Back to Nexora Home</span>
      </button>
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
  onBack?: () => void;
  onLogout: () => void;
  accentHex?: string;
  children?: React.ReactNode;
}> = ({
  section,
  displayName,
  email,
  partnerId,
  avatarUrl,
  notifications = [],
  notificationsLoading = false,
  navigate,
  onBack,
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
  const returnHome = () => {
    setNavOpen(false);
    setOpenMenu(null);
    if (onBack) onBack();
    else navigate('/');
  };

  const menusOpen = openMenu !== null;
  const toggleMenu = (menu: 'profile' | 'notifications') =>
    setOpenMenu((current) => (current === menu ? null : menu));

  // Escape closes the open drawer and the open dropdown (keyboard users get
  // the same affordance as a click on the backdrop).
  useEffect(() => {
    if (!navOpen && !menusOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (navOpen && event.key === 'Tab') {
        const nodes = [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]') ?? [])];
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === drawerRef.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
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
    if (!navOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [navOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) setNavOpen(false); };
    closeOnDesktop();
    desktop.addEventListener?.('change', closeOnDesktop);
    return () => desktop.removeEventListener?.('change', closeOnDesktop);
  }, []);

  return (
    <div className="min-h-dvh overflow-x-hidden bg-slate-50">
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
          onHome={returnHome}
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
        role="dialog"
        aria-modal={navOpen || undefined}
        aria-label="Growth Partner navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl outline-none transition-[transform,visibility] duration-200 motion-reduce:transition-none lg:hidden ${
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
          onHome={returnHome}
          onLogout={onLogout}
        />
      </div>

      {/* Content column (offset by the sidebar width on lg+). */}
      <div className="min-w-0 lg:pl-64" inert={navOpen}>
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
              <button
                type="button"
                title="Back to Nexora Home"
                aria-label="Back to Nexora Home"
                data-partner-home
                onClick={returnHome}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                <Home className="h-5 w-5" />
                <span className="hidden md:inline">Home</span>
              </button>
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
                    className="fixed right-4 top-16 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] sm:absolute sm:right-0 sm:top-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
                  >
                    <PartnerNotificationsPanel
                      entries={notifications}
                      loading={notificationsLoading}
                      onOpenAll={(event) => {
                        // Same rule as the sidebar: a plain left click stays in
                        // the SPA, modified clicks let the browser handle the link.
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                        event.preventDefault();
                        setOpenMenu(null);
                        navigate(partnerPortalPath('notifications'));
                      }}
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
                  {avatarUrl ? <img src={avatarUrl} alt="Profile" className="h-8 w-8 shrink-0 rounded-full object-cover" /> : <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white"
                    style={{ backgroundColor: accentHex }}
                  >
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>}
                  <span className="hidden min-w-0 max-w-40 leading-tight sm:block">
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
                    className="fixed right-4 top-16 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] sm:absolute sm:right-0 sm:top-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
                  >
                    <PartnerProfileMenu
                      displayName={displayName}
                      email={email}
                      partnerId={partnerId}
                      avatarUrl={avatarUrl}
                      onNavigateProfile={() => {
                        setOpenMenu(null);
                        navigate(partnerPortalPath('profile'));
                      }}
                      onNavigateAccountSettings={() => {
                        setOpenMenu(null);
                        navigate(partnerPortalPath('account-settings'));
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
        <main id="partner-portal-main" className="mx-auto min-w-0 max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
};
