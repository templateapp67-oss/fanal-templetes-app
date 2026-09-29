import React from 'react';
import { Home, Scissors, CalendarCheck, MapPin, MessageSquare, PhoneCall } from 'lucide-react';

export type MobileNavSection = 'home' | 'services' | 'location';

export interface MobileBottomNavProps {
  activeSection: MobileNavSection;
  onNavigateSection: (section: MobileNavSection) => void;
  onQuickBook: () => void;
  whatsappNumber?: string;
  phoneNumber?: string;
  businessName?: string;
  accentColor?: string;
  /** When true (e.g. desktop user toggled Mobile device preview), also renders inside the preview frame on md+ screens. */
  forceShowInPreview?: boolean;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeSection,
  onNavigateSection,
  onQuickBook,
  whatsappNumber,
  phoneNumber,
  businessName = 'Salon',
  accentColor = 'var(--primary-accent, #C20E5A)',
  forceShowInPreview = false,
}) => {
  const cleanWhatsapp = (whatsappNumber || '').replace(/\D/g, '');
  const formattedWhatsapp =
    /^\d{7,15}$/.test(cleanWhatsapp)
      ? cleanWhatsapp.length === 10
        ? `91${cleanWhatsapp}`
        : cleanWhatsapp
      : '';
  const cleanPhone = (phoneNumber || '').replace(/[^\d+]/g, '');

  const renderNavItems = () => (
    <div className="mx-auto grid w-full max-w-full grid-cols-5 items-center px-1.5 py-1 box-border">
      {/* 1. Home (/) */}
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
        <span className="truncate max-w-full">Home</span>
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

      {/* 3. Quick Book (#book / Booking Modal) — Highlighted Primary CTA */}
      <button
        type="button"
        data-target="#book"
        onClick={onQuickBook}
        aria-label="Quick Book Appointment"
        className="group relative -mt-2.5 flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1.5 py-1.5 text-[10px] font-extrabold text-white shadow-md transition-all hover:opacity-95 active:scale-95 cursor-pointer"
        style={{ backgroundColor: accentColor }}
      >
        <CalendarCheck className="h-4 w-4 shrink-0 text-white" />
        <span className="truncate max-w-full leading-tight">Quick Book</span>
      </button>

      {/* 4. Location (#location) */}
      <button
        type="button"
        data-target="#location"
        onClick={() => onNavigateSection('location')}
        className={`relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-bold transition-all active:scale-95 cursor-pointer ${
          activeSection === 'location' ? 'text-slate-950' : 'text-slate-500 hover:text-slate-900'
        }`}
        style={activeSection === 'location' ? { color: accentColor } : undefined}
      >
        {activeSection === 'location' && (
          <span
            className="absolute inset-x-3 top-0 h-0.5 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
        )}
        <MapPin className="h-4 w-4 shrink-0" />
        <span className="truncate max-w-full">Location</span>
      </button>

      {/* 5. WhatsApp / Call */}
      {formattedWhatsapp ? (
        <a
          href={`https://wa.me/${formattedWhatsapp}?text=${encodeURIComponent(
            `Hi ${businessName}, I would like to inquire about booking an appointment.`
          )}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-bold text-emerald-600 transition-all hover:text-emerald-700 active:scale-95"
        >
          <MessageSquare className="h-4 w-4 shrink-0" />
          <span className="truncate max-w-full">WhatsApp</span>
        </a>
      ) : (
        <a
          href={cleanPhone ? `tel:${cleanPhone}` : '#location-section'}
          onClick={(e) => {
            if (!cleanPhone) {
              e.preventDefault();
              onNavigateSection('location');
            }
          }}
          className="flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-bold text-slate-700 transition-all hover:text-slate-950 active:scale-95"
        >
          <PhoneCall className="h-4 w-4 shrink-0" />
          <span className="truncate max-w-full">Call</span>
        </a>
      )}
    </div>
  );

  return (
    <>
      {/* Native fixed bottom navigation bar on mobile viewports */}
      <nav
        aria-label="Salon quick actions"
        className="block md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-t border-gray-200 shadow-lg [padding-bottom:env(safe-area-inset-bottom)]"
      >
        {renderNavItems()}
      </nav>

      {/* In-frame sticky bottom navigation bar when previewing Mobile mode on desktop */}
      {forceShowInPreview && (
        <nav
          aria-label="Salon quick actions mobile preview"
          className="hidden md:block sticky bottom-0 left-0 right-0 z-40 w-full max-w-full bg-white/90 backdrop-blur-md border-t border-gray-200 shadow-lg"
        >
          {renderNavItems()}
        </nav>
      )}
    </>
  );
};
