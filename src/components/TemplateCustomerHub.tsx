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

export function TemplateCustomerHub({
  request,
  onClose,
  profile,
  services,
  previewMode,
  accentHex,
  dark,
}: {
  request: TemplateCustomerRequest | null;
  onClose: () => void;
  profile: SalonProfile;
  services: SalonService[];
  previewMode: boolean;
  accentHex: string;
  dark: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState("/app");
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (request) {
      setActivated(true);
      const section =
        request.section === "services" || request.section === "packages"
          ? "salon"
          : request.section;
      const id = ["salon", "book"].includes(section)
        ? `/${encodeURIComponent(profile.subdomain)}`
        : "";
      const tab = ["services", "packages"].includes(request.section)
        ? `/${request.section}`
        : "";
      setPath(`/app/${section === "home" ? "" : section}${id}${tab}`);
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) dialog.close();
  }, [request, profile.subdomain]);
  useEffect(() => {
    if (!request) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [Boolean(request)]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className={`template-customer-dialog ${dark ? "customer-dark" : ""}`}
      aria-label={`${profile.businessName} customer area`}
      style={
        {
          "--customer-accent": accentHex,
          "--customer-nav-accent":
            dark && getLuminance(accentHex) < 0.2 ? "#d4af37" : accentHex,
          "--customer-on-accent": getContrastTextColor(accentHex),
        } as React.CSSProperties
      }
    >
      <header className="customer-panel-header flex items-center justify-between gap-3 px-4 py-3 border-b sticky top-0 z-50">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest opacity-60">
            Your salon, your time
          </p>
          <h2 className="text-base font-bold truncate">
            {profile.businessName}
          </h2>
        </div>
        <button
          type="button"
          autoFocus
          aria-label="Close customer area"
          onClick={onClose}
          className="min-h-11 min-w-11 rounded-full border flex items-center justify-center"
        >
          <X size={20} />
        </button>
      </header>
      <React.Suspense
        fallback={
          <p className="p-6 text-sm" role="status">
            Opening your customer area…
          </p>
        }
      >
        {activated &&
          (previewMode ? (
            <TemplateCustomerDemo
              key={profile.businessType}
              request={request}
              profile={profile}
              services={services}
            />
          ) : (
            request && (
              <CustomerApp
                embedded
                path={path}
                navigate={setPath}
                accentHex={accentHex}
                tenantName={profile.businessName}
                initialServiceIds={request.serviceIds}
              />
            )
          ))}
      </React.Suspense>
    </dialog>,
    document.body,
  );
}
