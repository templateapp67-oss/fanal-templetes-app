import { TemplateCustomerCatalogue } from './TemplateCustomerCatalogue';
import { templateCustomerPath } from '../lib/templateCustomerNavigation';
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  CalendarDays,
  Gift,
  Heart,
  MapPin,
  Search,
  UserRound,
  X,
  ChevronRight,
} from "lucide-react";
import { getContrastTextColor, getLuminance } from "../themeAccents";
const CustomerApp = React.lazy(() =>
  import("../customer/CustomerApp").then((module) => ({
    default: module.CustomerApp,
  })),
);
import type { SalonProfile, SalonService } from "../types";
const TemplateCustomerDemo = React.lazy(() =>
  import("./TemplateCustomerDemo").then((module) => ({
    default: module.TemplateCustomerDemo,
  })),
);

export type TemplateCustomerSection =
  | "home"
  | "salon"
  | "services"
  | "packages"
  | "book"
  | "bookings"
  | "wallet"
  | "notifications"
  | "favourites"
  | "profile"
  | "location"
  | "settings"
  | "auth";
export interface TemplateCustomerRequest {
  section: TemplateCustomerSection;
  serviceIds?: string[];
  path?: string;
}

export function TemplateCustomerToolbar({
  profile,
  onOpen,
  signedIn,
}: {
  profile: SalonProfile;
  onOpen: (section: TemplateCustomerSection) => void;
  signedIn?: boolean;
}) {
  return (
    <div
      className="template-customer-toolbar border-b border-current/10 px-4 py-3 flex flex-wrap items-center gap-2"
      aria-label="Customer tools"
    >
      <button
        type="button"
        onClick={() => onOpen("location")}
        className="flex items-center gap-1.5 min-h-11 text-xs font-semibold"
      >
        <MapPin size={16} />
        <span className="max-w-36 truncate">
          {profile.city || "Choose location"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onOpen("home")}
        className="flex flex-1 min-w-32 items-center gap-2 min-h-11 rounded-full bg-current/5 border border-current/10 px-4 text-xs text-left"
      >
        <Search size={16} />
        Search salons & services
      </button>
      {[
        { section: "favourites" as const, label: "Favorites", Icon: Heart },
        {
          section: "notifications" as const,
          label: "Notifications",
          Icon: Bell,
        },
        {
          section: "profile" as const,
          label: signedIn ? "My profile" : "Sign in / Profile",
          Icon: UserRound,
        },
      ].map(({ section, label, Icon }) => (
        <button
          type="button"
          key={section}
          aria-label={label}
          title={label}
          onClick={() => onOpen(section)}
          className="min-h-11 min-w-11 rounded-full flex items-center justify-center border border-current/10 hover:bg-current/5"
        >
          <Icon size={18} />
        </button>
      ))}
      <div className="flex w-full gap-2 overflow-x-auto scrollbar-none pt-1">
        {[
          { section: "home" as const, label: "Explore salons", Icon: Search },
          { section: "packages" as const, label: "Packages", Icon: Gift },
          {
            section: "bookings" as const,
            label: "My appointments",
            Icon: CalendarDays,
          },
          { section: "wallet" as const, label: "Rewards", Icon: Gift },
        ].map(({ section, label, Icon }) => (
          <button
            key={section}
            type="button"
            onClick={() => onOpen(section)}
            className="min-h-9 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-current/10 px-3 text-xs font-medium hover:bg-current/5"
          >
            <Icon size={14} />
            {label}
            <ChevronRight size={12} />
          </button>
        ))}
      </div>
    </div>
  );
}

const DESKTOP_SECTIONS: Array<{ section: TemplateCustomerSection; label: string }> = [
  { section: 'services', label: 'All services' }, { section: 'packages', label: 'Packages' },
  { section: 'bookings', label: 'My appointments' }, { section: 'favourites', label: 'Favorites' },
  { section: 'wallet', label: 'Rewards' }, { section: 'profile', label: 'My profile' },
  { section: 'notifications', label: 'Notifications' }, { section: 'settings', label: 'Settings' },
];

export function TemplateCustomerHub({ request, onClose, onOpen, onNavigate, profile, services, previewMode, accentHex, dark, forceMobile = false, onBookServices }: {
  request: TemplateCustomerRequest | null; onClose: () => void;
  onBookServices?: (ids: string[]) => void;
  onOpen?: (section: TemplateCustomerSection) => void; onNavigate?: (path: string) => void;
  profile: SalonProfile; services: SalonService[]; previewMode: boolean; accentHex: string; dark: boolean; forceMobile?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [localPath, setLocalPath] = useState('/app');
  const [activated, setActivated] = useState(false);
  const desktop = wide && !forceMobile;
  const path = request ? templateCustomerPath(request, profile.subdomain) : localPath;
  const navigate = (next: string) => { setLocalPath(next); onNavigate?.(next); };
  useEffect(() => {
    const resize = () => setWide(window.innerWidth >= 1024);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (request) { setActivated(true); setLocalPath(templateCustomerPath(request, profile.subdomain)); }
    const dialog = dialogRef.current;
    if (!desktop && request && dialog && !dialog.open) dialog.showModal();
    else if ((desktop || !request) && dialog?.open) dialog.close();
    if (desktop && request) { pageRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); pageRef.current?.focus({ preventScroll: true }); }
  }, [request, profile.subdomain, desktop]);
  useEffect(() => {
    if (!request || desktop) return;
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [Boolean(request), desktop]);
  if (typeof document === 'undefined') return null;
  const style = { '--customer-accent': accentHex, '--customer-nav-accent': dark && getLuminance(accentHex) < 0.2 ? '#d4af37' : accentHex, '--customer-on-accent': getContrastTextColor(accentHex) } as React.CSSProperties;
  const header = <header className="customer-panel-header flex items-center justify-between gap-3 px-4 py-3 border-b">
    <div className="min-w-0"><p className="text-xs uppercase tracking-widest opacity-60">Your salon, your time</p><h2 className="text-base font-bold truncate">{profile.businessName}</h2></div>
    <button type="button" aria-label={desktop ? 'Back to salon website' : 'Close customer area'} onClick={onClose} className="min-h-11 min-w-11 rounded-full border flex items-center justify-center">{desktop ? <span className="px-3 text-sm">Back to website</span> : <X size={20} />}</button>
  </header>;
  const content = <React.Suspense fallback={<p className="p-6 text-sm" role="status">Opening your customer area…</p>}>
    {activated && (previewMode ? <TemplateCustomerDemo key={profile.businessType} request={request} profile={profile} services={services} onNavigateSection={onOpen} desktop={desktop} /> : request && (request.section === 'services' || request.section === 'packages') ? <TemplateCustomerCatalogue section={request.section} profile={profile} services={services} onBook={ids => onBookServices?.(ids)} onServices={() => onOpen?.('services')} /> : request && <CustomerApp embedded desktopLayout={desktop} path={path} navigate={navigate} accentHex={accentHex} tenantName={profile.businessName} initialServiceIds={request.serviceIds} />)}
  </React.Suspense>;
  if (desktop) return request ? <section ref={pageRef} tabIndex={-1} data-template-customer-page className={`template-customer-desktop ${dark ? 'customer-dark' : ''}`} style={style} aria-label={`${profile.businessName} customer area`}>
    {header}<div className="template-customer-desktop-grid"><aside><nav aria-label="Salon customer pages">{DESKTOP_SECTIONS.map(item => <button type="button" key={item.section} aria-current={request.section === item.section ? 'page' : undefined} onClick={() => onOpen ? onOpen(item.section) : navigate(templateCustomerPath({ section: item.section }, profile.subdomain))}>{item.label}</button>)}</nav></aside><div className="template-customer-main min-w-0">{content}</div></div>
  </section> : null;
  return createPortal(<dialog ref={dialogRef} onCancel={onClose} className={`template-customer-dialog ${dark ? 'customer-dark' : ''}`} aria-label={`${profile.businessName} customer area`} style={style}>{header}{content}</dialog>, document.body);
}
