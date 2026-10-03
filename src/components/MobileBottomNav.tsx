import React, { useEffect, useState } from 'react';
import {
  Home,
  Gift,
  UserRound,
  Heart,
  Bell,
  Scissors,
  CalendarCheck,
  CalendarClock,
  MoreHorizontal,
  MessageSquare,
  PhoneCall,
  X,
  Info,
  Images,
  Star,
  HelpCircle,
} from 'lucide-react';

export type MobileNavSection = 'home' | 'services' | 'location';

/** Targets reachable from the "More" bottom sheet. */
export type MobileMoreTarget = 'about' | 'gallery' | 'reviews' | 'faq';

export interface MobileBottomNavProps {
  activeSection: MobileNavSection;
  onNavigateSection: (section: MobileNavSection) => void;
  onQuickBook: () => void;
  /** Opens the customer "My Bookings" area. */
  onOpenBookings?: () => void;
  onOpenRewards?: () => void;
  onOpenProfile?: () => void;
  onOpenFavorites?: () => void;
  onOpenNotifications?: () => void;
  /** Handles navigation from the "More" bottom sheet (About / Gallery / Reviews / FAQ). */
  onMoreNavigate?: (target: MobileMoreTarget) => void;
  whatsappNumber?: string;
  phoneNumber?: string;
  businessName?: string;
  accentColor?: string;
  /** When true (e.g. desktop user toggled Mobile device preview), also renders inside the preview frame on md+ screens. */
  forceShowInPreview?: boolean;
}

const MORE_LINKS: { target: MobileMoreTarget; label: string; Icon: typeof Info }[] = [
  { target: 'about', label: 'About', Icon: Info },
  { target: 'gallery', label: 'Gallery', Icon: Images },
  { target: 'reviews', label: 'Reviews', Icon: Star },
  { target: 'faq', label: 'FAQ & Contact', Icon: HelpCircle },
];

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeSection,
  onNavigateSection,
  onQuickBook,
  onOpenBookings,
  onOpenRewards,
  onOpenProfile,
  onOpenFavorites,
  onOpenNotifications,
  onMoreNavigate,
  whatsappNumber,
  phoneNumber,
  businessName = 'Salon',
  accentColor = 'var(--primary-accent, #C20E5A)',
  forceShowInPreview = false,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const cleanWhatsapp = (whatsappNumber || '').replace(/\D/g, '');
  const formattedWhatsapp =
    /^\d{7,15}$/.test(cleanWhatsapp)
      ? cleanWhatsapp.length === 10
        ? `91${cleanWhatsapp}`
        : cleanWhatsapp
      : '';
  const cleanPhone = (phoneNumber || '').replace(/[^\d+]/g, '');

  // Lock background page scroll while the "More" bottom sheet is open.
  useEffect(() => {
    if (!isMoreOpen || typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMoreOpen]);

  const closeMoreSheet = () => setIsMoreOpen(false);

  const handleMoreLink = (target: MobileMoreTarget) => {
    setIsMoreOpen(false);
    onMoreNavigate?.(target);
  };

  const renderNavItems = () => (
    <div className="mx-auto grid w-full max-w-full grid-cols-6 items-center px-1.5 py-1 box-border">
      {/* 1. Explore (/) */}
      <button
        type="button"
        data-target="#home-section"
        onClick={() => onNavigateSection('home')}
        className={`relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-bold transition-all active:scale-95 cursor-pointer ${
          activeSection === 'home' ? 'text-slate-950' : 'text-slate-500 hover:text-slate-900'
        }`}
        style={activeSection === 'home' ? { color: accentColor } : undefined}
      >
        {activeSection === 'home' && (
          <span
            className="absolute inset-x-3 top-0 h-0.5 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
        )}
        <Home className="h-4 w-4 shrink-0" />
        <span className="truncate max-w-full">Explore</span>
      </button>

      {/* 2. Services / Menu (#services) */}
      <button
        type="button"
        data-target="#services"
        onClick={() => onNavigateSection('services')}
        className={`relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-bold transition-all active:scale-95 cursor-pointer ${
          activeSection === 'services' ? 'text-slate-950' : 'text-slate-500 hover:text-slate-900'
        }`}
        style={activeSection === 'services' ? { color: accentColor } : undefined}
      >
        {activeSection === 'services' && (
          <span
            className="absolute inset-x-3 top-0 h-0.5 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
        )}
        <Scissors className="h-4 w-4 shrink-0" />
        <span className="truncate max-w-full">Services</span>
      </button>

      {/* 3. Book Now — Highlighted Primary CTA (center) */}
      <button
        type="button"
        data-target="#book"
        onClick={onQuickBook}
        aria-label="Book Now"
        className="group relative -mt-2.5 flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1.5 py-1.5 text-[10px] font-extrabold text-white shadow-md transition-all hover:opacity-95 active:scale-95 cursor-pointer"
        style={{ backgroundColor: accentColor }}
      >
        <CalendarCheck className="h-4 w-4 shrink-0 text-white" />
        <span className="truncate max-w-full leading-tight">Book Now</span>
      </button>

      {/* 4. My Bookings */}
      <button
        type="button"
        data-target="#bookings"
        onClick={() => onOpenBookings?.()}
        aria-label="My Bookings"
        className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-bold text-slate-600 transition-all hover:text-slate-950 active:scale-95 cursor-pointer"
      >
        <CalendarClock className="h-4 w-4 shrink-0" />
        <span className="truncate max-w-full">Bookings</span>
      </button>

      <button type="button" onClick={onOpenRewards} aria-label="Rewards" className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-bold text-slate-600 cursor-pointer"><Gift className="h-4 w-4" /><span>Rewards</span></button>
      {/* 5. More — opens the bottom sheet (About / Gallery / Reviews / FAQ) */}
      <button
        type="button"
        data-target="#more"
        onClick={() => setIsMoreOpen(true)}
        aria-label="More"
        aria-expanded={isMoreOpen}
        className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-bold text-slate-600 transition-all hover:text-slate-950 active:scale-95 cursor-pointer"
      >
        <MoreHorizontal className="h-4 w-4 shrink-0" />
        <span className="truncate max-w-full">More</span>
      </button>
    </div>
  );

  const renderMoreSheet = (visibilityClass: string) => {
    if (!isMoreOpen) return null;
    return (
      <div
        className={`fixed inset-0 z-[60] ${visibilityClass} items-end justify-center`}
        role="dialog"
        aria-modal="true"
        aria-label={`${businessName} — More options`}
      >
        {/* Backdrop */}
        <button
          type="button"
          aria-label="Close menu"
          onClick={closeMoreSheet}
          className="absolute inset-0 bg-black/45 backdrop-blur-[2px] cursor-pointer"
        />
        {/* Glassmorphic sheet */}
        <div className="mobile-sheet relative w-full rounded-t-3xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl border-t border-slate-200/70 dark:border-neutral-700/60 shadow-2xl [padding-bottom:env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <p className="text-sm font-extrabold text-slate-900 dark:text-neutral-100 truncate">
              {businessName}
            </p>
            <button
              type="button"
              onClick={closeMoreSheet}
              aria-label="Close"
              className="h-9 w-9 rounded-full flex items-center justify-center bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-neutral-300 cursor-pointer active:scale-95 transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-3 pb-4 grid grid-cols-2 gap-2">
            {[{ label: 'Profile', Icon: UserRound, onClick: onOpenProfile }, { label: 'Favorites', Icon: Heart, onClick: onOpenFavorites }, { label: 'Notifications', Icon: Bell, onClick: onOpenNotifications }].filter(link => link.onClick).map(({ label, Icon, onClick }) => <button type="button" key={label} onClick={() => { closeMoreSheet(); onClick?.(); }} className="flex min-h-[48px] items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-left text-xs font-bold text-slate-800"><Icon className="w-5 h-5" />{label}</button>)}
            {MORE_LINKS.map(({ target, label, Icon }) => (
              <button
                key={target}
                type="button"
                onClick={() => handleMoreLink(target)}
                className="flex min-h-[48px] items-center gap-2.5 rounded-2xl border border-slate-200/80 dark:border-neutral-700/70 bg-slate-50 dark:bg-neutral-800/60 px-3.5 py-2.5 text-left cursor-pointer active:scale-[0.98] transition-all"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: accentColor }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-neutral-100 truncate">
                  {label}
                </span>
              </button>
            ))}
          </div>
          {/* Quick contact fallbacks live in the sheet instead of crowding the dock */}
          {(formattedWhatsapp || cleanPhone) && (
            <div className="px-3 pb-4 flex gap-2">
              {formattedWhatsapp && (
                <a
                  href={`https://wa.me/${formattedWhatsapp}?text=${encodeURIComponent(
                    `Hi ${businessName}, I would like to inquire about booking an appointment.`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 text-white text-xs font-bold px-3 py-2.5 active:scale-[0.98] transition-all"
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <span className="truncate">WhatsApp</span>
                </a>
              )}
              {cleanPhone && (
                <a
                  href={`tel:${cleanPhone}`}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-2xl border border-slate-300 dark:border-neutral-600 text-slate-800 dark:text-neutral-100 text-xs font-bold px-3 py-2.5 active:scale-[0.98] transition-all"
                >
                  <PhoneCall className="h-4 w-4 shrink-0" />
                  <span className="truncate">Call Us</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {forceShowInPreview ? (
        <nav aria-label="Salon quick actions mobile preview" className="sticky bottom-0 z-40 w-full max-w-full bg-white/90 dark:bg-neutral-950/90 backdrop-blur-md border-t border-gray-200 dark:border-neutral-800 shadow-lg [padding-bottom:env(safe-area-inset-bottom)]">
          {renderNavItems()}
        </nav>
      ) : (
        <nav aria-label="Salon quick actions" className="block @min-[768px]/salon:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-neutral-950/90 backdrop-blur-md border-t border-gray-200 dark:border-neutral-800 shadow-lg [padding-bottom:env(safe-area-inset-bottom)]">
          {renderNavItems()}
        </nav>
      )}
      {renderMoreSheet(forceShowInPreview ? 'flex' : 'flex @min-[768px]/salon:hidden')}
    </>
  );
};
