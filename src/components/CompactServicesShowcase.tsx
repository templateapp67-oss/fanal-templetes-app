import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, ChevronLeft, ChevronRight, Clock, MessageSquare, Sparkles } from 'lucide-react';
import type { SalonService } from '../types';
import { shortServiceDescription } from './SalonWebsitePreview';

// ============================================================================
// COMPACT SERVICES SHOWCASE — the mobile-first services layout shared by all
// 27 Nexora templates and every published `/?site=slug` client site.
//
// Layout contract (app-like, minimal page height):
//   • Strict deduplication — a service/product can only appear ONCE on the
//     whole page (identity = normalized name).
//   • Remaining unique items are grouped under bold CATEGORY headings.
//   • Each category renders its items in ONE single-line horizontal row with
//     native touch-swipe physics (`overflow-x-auto snap-x snap-mandatory`)
//     and completely hidden scrollbars (`.scrollbar-none`).
//   • Compact cards: `w-[170px] sm:w-[220px] flex-shrink-0 snap-start` —
//     several items fit side-by-side without ever forcing horizontal page
//     overflow on the outer wrapper.
//   • Desktop mouse users get circular 32×32 overlay arrow controls
//     (`hidden md:flex`); touch devices keep their native swipe.
//
// The owner's editable grid (edit mode) is untouched — this component only
// replaces the READ-ONLY customer-facing rendering.
// ============================================================================

/** Identity for deduplication: case-insensitive, trimmed display name. */
function serviceIdentity(service: SalonService): string {
  return String(service?.name ?? '').trim().toLowerCase();
}

export interface ServiceCategoryGroup {
  /** Bold category heading shown above the row. */
  label: string;
  services: SalonService[];
}

/**
 * Strict deduplication + categorization. The FIRST occurrence of a name wins;
 * later duplicates are dropped so no service appears twice anywhere on the
 * page. Category order follows first appearance in the owner's menu.
 */
export function groupUniqueServicesByCategory(services: SalonService[]): ServiceCategoryGroup[] {
  const seen = new Set<string>();
  const groups = new Map<string, SalonService[]>();

  for (const service of services ?? []) {
    if (!service) continue;
    const identity = serviceIdentity(service);
    // Unnamed rows keep rendering (owners may still be typing) but can never
    // collide with each other: fall back to their stable id.
    const key = identity || `__unnamed__:${String(service.id ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const label = String(service.category ?? '').trim() || 'Signature Treatments';
    const bucket = groups.get(label);
    if (bucket) bucket.push(service);
    else groups.set(label, [service]);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, services: items }));
}

/** One compact card inside a horizontal category row. */
const CompactServiceCard: React.FC<{
  service: SalonService;
  accentHex: string;
  isDarkCanvas: boolean;
  imageFallback: string;
  acceptsOnlineBookings: boolean;
  /** Per-service WhatsApp booking link (empty → plain "Contact to book"). */
  whatsappHrefFor?: (service: SalonService) => string;
  onBook: (service: SalonService) => void;
  onPreviewIntercept?: (event: React.MouseEvent) => void;
}> = ({
  service,
  accentHex,
  isDarkCanvas,
  imageFallback,
  acceptsOnlineBookings,
  whatsappHrefFor,
  onBook,
  onPreviewIntercept,
}) => {
  const whatsappHref = whatsappHrefFor?.(service) || '';
  const hasDiscount =
    service.originalPrice != null && Number(service.originalPrice) > Number(service.price);

  return (
    <div
      data-testid="compact-service-card"
      className={`w-[170px] sm:w-[220px] flex-shrink-0 snap-start rounded-2xl border overflow-hidden flex flex-col gap-2 p-2.5 transition-all duration-300 group ${
        isDarkCanvas
          ? 'bg-neutral-900/80 border-neutral-800 hover:border-neutral-700'
          : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
      }`}
    >
      <div className="relative w-full overflow-hidden rounded-xl">
        <img
          src={service.imageUrl || imageFallback}
          alt={service.name}
          loading="lazy"
          className="h-24 sm:h-28 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          onError={(event) => {
            const img = event.currentTarget;
            if (!img.src.endsWith('/service-placeholder.svg')) {
              img.src = img.src === imageFallback ? '/service-placeholder.svg' : imageFallback;
            }
          }}
        />
        {service.popular && (
          <span
            className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-mono font-extrabold uppercase tracking-wider shadow-xs"
            style={{ backgroundColor: accentHex, color: 'var(--accent-text-color, #ffffff)' }}
          >
            <Sparkles className="w-2.5 h-2.5 shrink-0" />
            Popular
          </span>
        )}
      </div>

      <h3
        className={`px-0.5 text-[13px] sm:text-sm font-extrabold leading-snug break-words hyphens-auto line-clamp-2 ${
          isDarkCanvas ? 'text-white' : 'text-slate-900'
        }`}
      >
        {service.name}
      </h3>

      {service.description ? (
        <p
          className={`px-0.5 -mt-1.5 text-[11px] leading-snug break-words line-clamp-2 ${
            isDarkCanvas ? 'text-neutral-400' : 'text-slate-500'
          }`}
        >
          {shortServiceDescription(service.description, false)}
        </p>
      ) : null}

      <div className="mt-auto px-0.5 flex items-center justify-between gap-1.5">
        <div className="min-w-0 flex items-baseline gap-1.5 font-mono">
          <span
            className={`text-sm sm:text-base font-extrabold ${
              isDarkCanvas ? 'text-emerald-400' : 'text-emerald-700'
            }`}
          >
            ₹{Number(service.price).toLocaleString('en-IN')}
          </span>
          {hasDiscount && (
            <del className="text-[10px] font-normal opacity-60 whitespace-nowrap" aria-label="Original price">
              ₹{Number(service.originalPrice).toLocaleString('en-IN')}
            </del>
          )}
        </div>
        {service.showDuration !== false && (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-mono ${
              isDarkCanvas
                ? 'border-neutral-700 bg-neutral-800 text-neutral-200'
                : 'border-slate-200 bg-slate-100 text-slate-700'
            }`}
          >
            <Clock className="w-2.5 h-2.5 shrink-0 opacity-70" />
            {service.durationMinutes}m
          </span>
        )}
      </div>

      {acceptsOnlineBookings ? (
        <button
          type="button"
          onClick={() => onBook(service)}
          className="min-h-[38px] w-full rounded-xl px-2 py-2 text-[11px] font-extrabold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer hover:opacity-95 active:scale-[0.97]"
          style={{ backgroundColor: accentHex, color: 'var(--accent-text-color, #ffffff)' }}
        >
          <CalendarCheck className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Book (₹{Number(service.price).toLocaleString('en-IN')})</span>
        </button>
      ) : (
        <a
          href={whatsappHref || '#location-section'}
          target={whatsappHref ? '_blank' : undefined}
          rel={whatsappHref ? 'noopener noreferrer' : undefined}
          onClick={(event) => onPreviewIntercept?.(event)}
          className="min-h-[38px] w-full rounded-xl px-2 py-2 text-[11px] font-extrabold inline-flex items-center justify-center gap-1.5 transition-all hover:opacity-95 active:scale-[0.97]"
          style={{ backgroundColor: accentHex, color: 'var(--accent-text-color, #ffffff)' }}
        >
          <MessageSquare className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{whatsappHref ? 'Book on WhatsApp' : 'Contact to book'}</span>
        </a>
      )}
    </div>
  );
};

/** One category: bold heading + single-line horizontal snap row + arrows. */
const CompactCategoryRow: React.FC<{
  group: ServiceCategoryGroup;
  accentHex: string;
  isDarkCanvas: boolean;
  imageFallback: string;
  acceptsOnlineBookings: boolean;
  whatsappHrefFor?: (service: SalonService) => string;
  onBook: (service: SalonService) => void;
  onPreviewIntercept?: (event: React.MouseEvent) => void;
}> = ({ group, accentHex, isDarkCanvas, imageFallback, acceptsOnlineBookings, whatsappHrefFor, onBook, onPreviewIntercept }) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const refreshArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // 2px tolerance absorbs sub-pixel rounding across browsers.
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    refreshArrows();
    const el = scrollerRef.current;
    if (!el) return;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refreshArrows) : null;
    observer?.observe(el);
    window.addEventListener('resize', refreshArrows);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', refreshArrows);
    };
  }, [refreshArrows, group.services.length]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 200), behavior: 'smooth' });
  };

  return (
    <div className="w-full max-w-full min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3
          className={`text-base sm:text-lg font-extrabold tracking-tight break-words hyphens-auto ${
            isDarkCanvas ? 'text-white' : 'text-slate-900'
          }`}
        >
          {group.label}
        </h3>
        <span className={`shrink-0 text-[10px] font-mono ${isDarkCanvas ? 'text-neutral-500' : 'text-slate-400'}`}>
          {group.services.length} {group.services.length === 1 ? 'service' : 'services'}
        </span>
      </div>

      <div className="relative w-full max-w-full min-w-0">
        {/* Desktop-only overlay arrows for mouse users (touch keeps native swipe). */}
        {canScrollLeft && (
          <button
            type="button"
            aria-label={`Scroll ${group.label} left`}
            onClick={() => scrollByPage(-1)}
            className={`hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 items-center justify-center rounded-full border shadow-md backdrop-blur-sm cursor-pointer transition-all hover:scale-105 ${
              isDarkCanvas
                ? 'bg-neutral-900/90 border-neutral-700 text-white'
                : 'bg-white/95 border-slate-200 text-slate-700'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            aria-label={`Scroll ${group.label} right`}
            onClick={() => scrollByPage(1)}
            className={`hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 items-center justify-center rounded-full border shadow-md backdrop-blur-sm cursor-pointer transition-all hover:scale-105 ${
              isDarkCanvas
                ? 'bg-neutral-900/90 border-neutral-700 text-white'
                : 'bg-white/95 border-slate-200 text-slate-700'
            }`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* Single-line horizontal snap row. Scrollbars fully hidden via
            `.scrollbar-none` (WebKit + Firefox + IE/Edge). */}
        <div
          ref={scrollerRef}
          onScroll={refreshArrows}
          role="list"
          aria-label={`${group.label} services`}
          className="flex flex-row overflow-x-auto snap-x snap-mandatory gap-3 pb-2 pt-0.5 scrollbar-none"
        >
          {group.services.map((service) => (
            <div key={`${group.label}-${service.id}`} role="listitem" className="flex-shrink-0 snap-start">
              <CompactServiceCard
                service={service}
                accentHex={accentHex}
                isDarkCanvas={isDarkCanvas}
                imageFallback={imageFallback}
                acceptsOnlineBookings={acceptsOnlineBookings}
                whatsappHrefFor={whatsappHrefFor}
                onBook={onBook}
                onPreviewIntercept={onPreviewIntercept}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export interface CompactServicesShowcaseProps {
  services: SalonService[];
  accentHex: string;
  isDarkCanvas: boolean;
  /** Template-specific placeholder when a service has no photo. */
  imageFallback: string;
  acceptsOnlineBookings: boolean;
  /** Builds the per-service WhatsApp booking link ('' → contact-to-book). */
  whatsappHrefFor?: (service: SalonService) => string;
  onBook: (service: SalonService) => void;
  /** Template demo intercept for the WhatsApp fallback link. */
  onPreviewIntercept?: (event: React.MouseEvent) => void;
}

export const CompactServicesShowcase: React.FC<CompactServicesShowcaseProps> = ({
  services,
  accentHex,
  isDarkCanvas,
  imageFallback,
  acceptsOnlineBookings,
  whatsappHrefFor,
  onBook,
  onPreviewIntercept,
}) => {
  const groups = useMemo(() => groupUniqueServicesByCategory(services), [services]);
  if (groups.length === 0) return null;

  return (
    <div data-testid="compact-services" className="w-full max-w-full min-w-0 flex flex-col gap-6 sm:gap-8">
      {groups.map((group) => (
        <CompactCategoryRow
          key={group.label}
          group={group}
          accentHex={accentHex}
          isDarkCanvas={isDarkCanvas}
          imageFallback={imageFallback}
          acceptsOnlineBookings={acceptsOnlineBookings}
          whatsappHrefFor={whatsappHrefFor}
          onBook={onBook}
          onPreviewIntercept={onPreviewIntercept}
        />
      ))}
    </div>
  );
};
