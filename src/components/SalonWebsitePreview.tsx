import { globalSiteConfig } from '../lib/globalSiteConfig';
import { ServicePriceFields } from './ServicePriceFields';
import { serviceImageFallback } from '../data/categoryStarterServices';
import { TikTokIcon } from './TikTokIcon';
import { isWithinPromotionDates } from '../utils/websitePromotions';
import { WebsiteLocationMap, websiteLocation } from './WebsiteLocationMap';
import { WebsiteVideoShowcase } from './WebsiteVideoShowcase';
import { YouTubeVideoEditor } from './YouTubeVideoEditor';
import { ContentImageField } from './ContentImageField';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { getSiteUrl } from '../lib/salonStore';
import { useSalonSEO } from '../lib/useSalonSEO';
import { useSalonFavicon } from '../lib/useSalonFavicon';
import { copyToClipboard } from '../lib/clipboard';
import { 
  CheckCircle2, 
  Sparkles, 
  Copy, 
  Check, 
  X, 
  CalendarCheck, 
  MapPin, 
  Phone, 
  MessageSquare, 
  Mail, 
  Clock, 
  Calendar,
  Star, 
  ShieldCheck,
  Facebook,
  Youtube,
  Instagram, 
  Award, 
  Navigation, 
  ExternalLink, 
  ChevronRight, 
  ChevronLeft,
  Home,
  List,
  PhoneCall,
  ZoomIn,
  ArrowRight, 
  Edit3, 
  Sliders, 
  Eye, 
  EyeOff, 
  Plus, 
  Trash2, 
  Wand2, 
  Smartphone, 
  Tablet, 
  Monitor, 
  Share2, 
  RefreshCw, 
  Scissors
} from 'lucide-react';
import { SalonProfile, SalonService, Stylist, Appointment, BusinessTypeId, SalonOffer } from '../types';
import { TEMPLATE_REGISTRY, getTemplateConfig, getTemplateContent, type Testimonial } from '../data/templates';
import { ACCENT_PALETTES, DEFAULT_CATEGORY_ACCENTS, AccentPaletteKey, applyPrimaryAccentCssVar, getContrastTextColor, getLuminance } from '../themeAccents';
import { createBlankSalonProfile } from '../lib/ownerSalonResolution';
import { BookingModal } from './BookingModal';
import { InlineEditable } from './InlineEditable';
import { SidePanelCustomizer, SectionVisibilityState, DEFAULT_SECTION_VISIBILITY } from './SidePanelCustomizer';
import { InteractiveMapSetup } from './InteractiveMapSetup';
import { computeHeroAIStyling, extractImageMoodAsync, HeroAIStyling } from '../utils/heroImageMood';
import { TestimonialModal } from './ClientTestimonials';
import { formatInstagramUrl, formatFacebookUrl, formatTikTokUrl, displaySocialHandle, getTikTokValue } from '../utils/social';
import { getServiceIcon } from './ServiceManagement';
import { slugifySalonName } from '../lib/salonStore';
import { useSalonData } from '../lib/useSalonData';

interface SalonWebsitePreviewProps {
  profile: SalonProfile;
  setProfile?: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services: SalonService[];
  setServices?: React.Dispatch<React.SetStateAction<SalonService[]>>;
  stylists: Stylist[];
  setStylists?: React.Dispatch<React.SetStateAction<Stylist[]>>;
  onAddAppointment: (appointment: Appointment) => void;
  onSelectCategory?: (categoryId: BusinessTypeId) => void;
  // Unified single-template engine (single source of truth from parent).
  onSelectTemplate?: (categoryId: BusinessTypeId) => void;
  selectedTemplateId?: BusinessTypeId;
  setSelectedTemplateId?: (categoryId: BusinessTypeId) => void;
  /** Owner template changes must be made in the central /templates explorer. */
  onOpenTemplateExplorer?: () => void;
  siteUrl?: string;
  /** When true, renders as a read-only public (customer) site — hides all owner
   *  controls (inline edit mode, customizer, AI studio, test booking, etc.). */
  publicView?: boolean;
  /** Isolated template demo: all actions are simulated and never write data. */
  previewMode?: boolean;
  forcedDeviceMode?: DeviceMode;
  /** Authenticated customer account, if one exists. */
  user?: { id?: string; email?: string } | null;
  /** Reuses App's existing login/signup modal. */
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  /**
   * Set when the customer tapped Rebook on "My Bookings". Opens the booking
   * flow with that service pre-selected and flags it as coming from history,
   * which is what makes the confirmation page offer "Book this service again".
   * `at` de-duplicates repeat taps on the same booking.
   */
  rebookRequest?: { serviceName: string; at: number } | null;
  isLoading?: boolean;
}

interface SalonOfferCardProps {
  offer: SalonOffer;
  isDarkCanvas: boolean;
}

const SalonOfferCard: React.FC<SalonOfferCardProps> = ({ offer, isDarkCanvas }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const ok = await copyToClipboard(offer.code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div 
      key={offer.id} 
      className={`rounded-2xl border overflow-hidden flex flex-col sm:flex-row relative transition-all duration-300 hover:shadow-md ${
        isDarkCanvas ? 'bg-[#16161c] border-neutral-800' : 'bg-slate-50/50 border-slate-200'
      }`}
    >
      {/* Left Side: Offer Image */}
      <div className="w-full sm:w-1/3 h-40 sm:h-auto relative shrink-0">
        <img 
          src={offer.imageUrl || 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=400&q=80'} 
          alt={offer.title} 
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute top-3 left-3 bg-red-500 text-white font-black px-2.5 py-1 rounded-lg text-xs tracking-wider shadow-sm">
          {offer.discountValue}
        </div>
      </div>

      {/* Right Side: Offer Details */}
      <div className="p-5 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="font-extrabold text-base md:text-lg leading-snug">{offer.title}</h3>
          <p className={`text-xs mt-1.5 line-clamp-2 leading-relaxed ${isDarkCanvas ? 'text-neutral-300' : 'text-slate-600'}`}>
            {offer.description}
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-dashed border-slate-200 dark:border-neutral-700 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">USE CODE</div>
              <div className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400 tracking-wider">
                {offer.code}
              </div>
            </div>
            <button 
              type="button"
              onClick={handleCopy}
              className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                copied 
                  ? 'bg-emerald-500 text-white animate-pulse' 
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700'
              }`}
            >
              {copied ? 'Copied! ✨' : 'Copy'}
            </button>
          </div>

          {/* Validity Badge & Countdown */}
          <div className="flex flex-col gap-1 text-[10px] text-slate-400 font-mono mt-1 pt-1.5 border-t border-slate-100 dark:border-neutral-800/50">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">calendar_today</span>
                <span>Validity: {offer.startDate || 'Now'} to {offer.expiryDate || 'Always'}</span>
              </span>
              {offer.expiryDate && (() => {
                const end = new Date(offer.expiryDate + 'T23:59:59');
                const diff = end.getTime() - new Date().getTime();
                const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                if (diff <= 0) {
                  return <span className="bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight">Expired</span>;
                }
                return (
                  <span className="bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight">
                    {days > 0 ? `${days}d left` : 'Ends Today'}
                  </span>
                );
              })()}
            </div>
            <div className="flex justify-between items-center text-[9px] text-slate-400/80 mt-0.5">
              <span className="underline cursor-help" title={offer.terms || 'Valid on select salon services.'}>Terms Apply</span>
            </div>
          </div>
        </div>
      </div>

      {/* Elegant slitted coupon circle separators (visual cue) */}
      <div className="hidden sm:block absolute left-[33.33%] top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white dark:bg-[#0f0f13] border-r border-slate-200 dark:border-neutral-800 z-10" />
    </div>
  );
};

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

export const SalonWebsitePreview: React.FC<SalonWebsitePreviewProps> = ({
  profile,
  setProfile: setProfileProp,
  services,
  setServices: setServicesProp,
  stylists,
  setStylists: setStylistsProp,
  onAddAppointment,
  onSelectCategory,
  onSelectTemplate,
  selectedTemplateId,
  setSelectedTemplateId,
  onOpenTemplateExplorer,
  siteUrl,
  publicView = false,
  previewMode = false,
  forcedDeviceMode,
  user,
  onRequireAuth,
  rebookRequest,
  isLoading = false,
}) => {
  // Every public template consumes the same published server payload. Props
  // are retained as a graceful initial/fallback render while the API responds.
  const publicSalon = useSalonData(
    publicView && !previewMode ? profile?.subdomain : null,
    { profile, services, stylists, selectedTemplateId: selectedTemplateId || null },
    publicView ? user?.id : null,
  );
  const resolvedProfile = publicView ? publicSalon.data.profile : profile;
  const resolvedServices = publicView ? publicSalon.data.services : services;
  const resolvedStylists = publicView ? publicSalon.data.stylists : stylists;
  // Fallback internal state if setters not passed
  const [internalProfile, setInternalProfile] = useState<SalonProfile>(resolvedProfile);
  const [internalServices, setInternalServices] = useState<SalonService[]>(resolvedServices);
  const [internalStylists, setInternalStylists] = useState<Stylist[]>(resolvedStylists);

  const activeProfile = (setProfileProp || publicView ? resolvedProfile : internalProfile) || createBlankSalonProfile();
  const setProfile = setProfileProp || setInternalProfile;

  const activeServices = setServicesProp || publicView ? resolvedServices : internalServices;
  const setServices = setServicesProp || setInternalServices;

  const activeStylists = setStylistsProp || publicView ? resolvedStylists : internalStylists;
  const setStylists = setStylistsProp || setInternalStylists;

  useEffect(() => {
    setInternalProfile(resolvedProfile);
    setInternalServices(resolvedServices);
    setInternalStylists(resolvedStylists);
  }, [publicView, resolvedProfile, resolvedServices, resolvedStylists]);

  // Dynamically update page titles, meta descriptions, canonical URLs, and structured data
  const siteConfig = React.useMemo(() => globalSiteConfig(activeProfile, activeServices), [activeProfile, activeServices]);
  useSalonSEO(activeProfile, true);

  const location = websiteLocation(activeProfile);
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.query)}`;
  const googleDirectionsUrl = location.directions;

  const minPrice = React.useMemo(() => {
    if (!activeServices || !Array.isArray(activeServices) || activeServices.length === 0) return null;
    const validPrices = activeServices.map(s => Number(s.price)).filter(p => !isNaN(p) && p > 0);
    return validPrices.length > 0 ? Math.min(...validPrices) : null;
  }, [activeServices]);

  const formattedAddress = React.useMemo(() => {
    return [activeProfile.address, activeProfile.city, activeProfile.state, activeProfile.postalCode]
      .filter((item): item is string => Boolean(item && String(item).trim().length > 0))
      .join(', ');
  }, [activeProfile.address, activeProfile.city, activeProfile.state, activeProfile.postalCode]);

  const displayOwnerName = React.useMemo(() => {
    const name = activeProfile.ownerName;
    if (name && name.trim() && name !== 'Template App') return name;
    return activeProfile.businessName || 'Salon Founder';
  }, [activeProfile.ownerName, activeProfile.businessName]);

  // Viewport & Editor Controls
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');
  const [mobileNavActive, setMobileNavActive] = useState<'home' | 'services' | 'location'>('home');
  useEffect(() => {
    if (forcedDeviceMode) setDeviceMode(forcedDeviceMode);
  }, [forcedDeviceMode]);
  const [editModeRequested, setIsEditMode] = useState<boolean>(false);
  const isEditMode = !publicView && editModeRequested;
  const [isCustomizerOpen, setIsCustomizerOpen] = useState<boolean>(false);

  // In public (customer) view there is NO owner header, so no top padding and
  // editing/customizer controls are always locked off.
  useEffect(() => {
    if (publicView) {
      setIsEditMode(false);
      setIsCustomizerOpen(false);
    }
  }, [publicView]);
  // IGNORE: single active template is controlled by the parent (App) via
  // selectedTemplateId. Only ONE template ever renders on this view.
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<BusinessTypeId>(
    selectedTemplateId || activeProfile.businessType || 'hair_salon'
  );

  // The parent is the single source of truth. When the parent changes
  // selectedTemplateId, sync this preview to it (and vice-versa).
  useEffect(() => {
    if (selectedTemplateId && selectedTemplateId !== selectedCategoryKey) {
      setSelectedCategoryKey(selectedTemplateId);
    }
  }, [selectedTemplateId]);

  // Also keep businessType in sync so the canvas always renders the right
  // template even if the parent's profile businessType changes.
  useEffect(() => {
    const source = selectedTemplateId || activeProfile.businessType;
    if (source && source !== selectedCategoryKey) {
      setSelectedCategoryKey(source as BusinessTypeId);
    }
  }, [selectedTemplateId, activeProfile.businessType]);


  // Side Panel Section Visibility
  const sectionVisibility: SectionVisibilityState = { ...DEFAULT_SECTION_VISIBILITY, ...activeProfile.sectionVisibility };
  const setSectionVisibility: React.Dispatch<React.SetStateAction<SectionVisibilityState>> = (next) => {
    setProfile(p => ({ ...p, sectionVisibility: typeof next === 'function' ? next({ ...DEFAULT_SECTION_VISIBILITY, ...p.sectionVisibility }) : next }));
  };

  const visibleOffers = (activeProfile.offers || []).filter(o => o.isActive !== false && isWithinPromotionDates(o.startDate, o.expiryDate));
  // Promotional Popup Trigger State
  const [showPromoPopup, setShowPromoPopup] = useState<boolean>(false);
  useEffect(() => {
    const hasActiveOffer = visibleOffers.length > 0;
    if (sectionVisibility.promoPopup && hasActiveOffer) {
      const timer = setTimeout(() => {
        setShowPromoPopup(true);
      }, 1200);
      return () => clearTimeout(timer);
    } else {
      setShowPromoPopup(false);
    }
  }, [sectionVisibility.promoPopup, activeProfile.offers]);

  // Active template configuration
  const activeTemplate = getTemplateConfig(selectedCategoryKey) || getTemplateConfig('hair_salon')!;
  const isVipTemplate = selectedCategoryKey === 'luxury_hair_salon' && activeProfile.vipExperience?.enabled !== false;
  const vipLabel = activeProfile.vipExperience?.conciergeLabel?.trim() || 'VIP Concierge';

  // Active Accent Palette selection
  const [selectedAccentKey, setSelectedAccentKey] = useState<AccentPaletteKey>(
    (activeProfile.themeAccentKey as AccentPaletteKey) || DEFAULT_CATEGORY_ACCENTS[selectedCategoryKey] || 'slate'
  );
  const isDarkCanvas = activeProfile.appearance === 'dark' ||
    (activeProfile.appearance !== 'light' && (activeTemplate.themeStyle.isDark || selectedAccentKey === 'obsidian'));
  const setIsDarkCanvas = (dark: boolean) => setProfile(p => ({ ...p, appearance: dark ? 'dark' : 'light' }));

  // Synchronize accent changes when profile.themeAccentKey changes externally
  useEffect(() => {
    if (
      activeProfile.themeAccentKey &&
      ACCENT_PALETTES[activeProfile.themeAccentKey as AccentPaletteKey] &&
      activeProfile.themeAccentKey !== selectedAccentKey
    ) {
      setSelectedAccentKey(activeProfile.themeAccentKey as AccentPaletteKey);
    }
  }, [activeProfile.themeAccentKey, selectedAccentKey]);

  const selectedAccent = ACCENT_PALETTES[selectedAccentKey] || ACCENT_PALETTES.slate;
  // Every template reads the same resolved brand palette; no template owns a
  // separate colour configuration.
  const activeAccent = {
    ...selectedAccent,
    primaryHex: activeProfile.primaryColor || activeProfile.customAccentColor || selectedAccent.primaryHex,
    secondaryHex: activeProfile.secondaryColor || selectedAccent.secondaryHex,
  };
  const primaryAccentColor = activeAccent.primaryHex;

  // Dynamically generate and inject favicons in document head
  useSalonFavicon(activeProfile, primaryAccentColor, true);

  // Update primary accent CSS variable across the document
  useEffect(() => {
    applyPrimaryAccentCssVar(primaryAccentColor, activeAccent.secondaryHex);
  }, [primaryAccentColor, activeAccent]);

  // Dynamic Image-Based AI Styling State
  const resolvedHeroUrl = activeProfile.coverImageUrl ?? activeTemplate.coverImageUrl ?? "";
  const [heroImageSrc, setHeroImageSrc] = useState<string>(resolvedHeroUrl);

  useEffect(() => {
    setHeroImageSrc(activeProfile.coverImageUrl ?? activeTemplate.coverImageUrl ?? "");
  }, [activeProfile.coverImageUrl, activeTemplate.coverImageUrl]);

  const [heroAIStyling, setHeroAIStyling] = useState<HeroAIStyling>(() =>
    computeHeroAIStyling(resolvedHeroUrl, primaryAccentColor)
  );

  useEffect(() => {
    let isMounted = true;

    extractImageMoodAsync(heroImageSrc, primaryAccentColor).then((extracted) => {
      if (isMounted) {
        setHeroAIStyling(extracted);
      }
    });

    return () => { isMounted = false; };
  }, [heroImageSrc, primaryAccentColor]);

  const baseStandardData = getTemplateContent(selectedCategoryKey) || getTemplateContent('hair_salon')!;
  const standardData = baseStandardData;
  const activeGalleryPhotos = (activeProfile.gallery ?? activeProfile.lookbookPhotos ?? baseStandardData.gallery).filter(photo => Boolean(photo.url));

  // Interactive filters & booking modals
  const [activeSubCategory, setActiveSubCategory] = useState<string>('All');
  const [isBookingOpen, setIsBookingOpen] = useState<boolean>(false);
  const [selectedService, setSelectedService] = useState<SalonService | undefined>(activeServices[0]);
  const [selectedStylist, setSelectedStylist] = useState<Stylist | undefined>(activeStylists[0]);
  const [selectedGalleryPhoto, setSelectedGalleryPhoto] = useState<string | null>(null);
  const pendingBookingRef = useRef<{ service?: SalonService; stylist?: Stylist } | null>(null);
  // True only for a booking started from "My Bookings" → Rebook, so the
  // confirmation page can offer "Book this service again" instead of the
  // generic CTA. Cleared when the modal closes.
  const [bookingFromHistory, setBookingFromHistory] = useState<boolean>(false);
  const handledRebookAtRef = useRef<number>(0);

  // Dynamic client testimonials state
  const activeReviews: Testimonial[] = activeProfile.testimonials ?? baseStandardData.reviews;
  const setActiveReviews: React.Dispatch<React.SetStateAction<Testimonial[]>> = next => setProfile(p => ({
    ...p, testimonials: typeof next === 'function' ? next(p.testimonials ?? baseStandardData.reviews) : next,
  }));
  const [testimonialIndex, setTestimonialIndex] = useState(0);
  const currentReview = activeReviews[Math.min(testimonialIndex, activeReviews.length - 1)];

  useEffect(() => {
    if (activeReviews.length <= 1) return;
    const interval = setInterval(() => {
      setTestimonialIndex((prev) => (prev + 1) % activeReviews.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [activeReviews.length]);

  const [isTestimonialModalOpen, setIsTestimonialModalOpen] = useState<boolean>(false);
  const [editingTestimonial, setEditingTestimonial] = useState<Testimonial | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false);
  const [promoCodeCopied, setPromoCodeCopied] = useState<boolean>(false);

  // Helper for promotional banner visual styling
  const getBannerThemeClasses = (preset?: string) => {
    switch (preset) {
      case 'gradient_purple':
        return {
          container: 'bg-gradient-to-r from-purple-950 via-indigo-950 to-slate-950 text-purple-100 border-b border-purple-500/30',
          badge: 'bg-purple-400 text-purple-950 border border-purple-300',
          btn: 'bg-gradient-to-r from-purple-400 to-pink-400 text-purple-950 hover:brightness-105',
          code: 'bg-purple-900/60 border-purple-400/40 text-purple-200',
        };
      case 'rose_velvet':
        return {
          container: 'bg-gradient-to-r from-pink-950 via-rose-900 to-stone-900 text-pink-100 border-b border-pink-500/30',
          badge: 'bg-pink-300 text-pink-950 border border-pink-200',
          btn: 'bg-white text-pink-950 hover:bg-pink-50',
          code: 'bg-pink-900/60 border-pink-400/40 text-pink-200',
        };
      case 'emerald_botanical':
        return {
          container: 'bg-gradient-to-r from-emerald-950 via-teal-950 to-slate-950 text-emerald-100 border-b border-emerald-500/30',
          badge: 'bg-emerald-400 text-emerald-950 border border-emerald-300',
          btn: 'bg-emerald-300 text-emerald-950 hover:bg-emerald-200',
          code: 'bg-emerald-900/60 border-emerald-400/40 text-emerald-200',
        };
      case 'obsidian_glam':
        return {
          container: 'bg-gradient-to-r from-neutral-950 via-stone-900 to-black text-white border-b border-neutral-800',
          badge: 'bg-white text-neutral-950 border border-neutral-200',
          btn: 'bg-amber-400 text-neutral-950 hover:bg-amber-300',
          code: 'bg-neutral-800 border-neutral-700 text-amber-300',
        };
      case 'sunset_coral':
        return {
          container: 'bg-gradient-to-r from-orange-950 via-rose-950 to-amber-950 text-orange-100 border-b border-orange-500/30',
          badge: 'bg-orange-400 text-orange-950 border border-orange-300',
          btn: 'bg-white text-orange-950 hover:bg-orange-50',
          code: 'bg-orange-900/60 border-orange-400/40 text-orange-200',
        };
      case 'royal_gold':
      default:
        return {
          container: 'bg-gradient-to-r from-rose-950 via-amber-950 to-red-950 text-amber-100 border-b border-amber-500/30',
          badge: 'bg-amber-400 text-amber-950 border border-amber-300',
          btn: 'bg-gradient-to-r from-amber-400 to-yellow-400 text-amber-950 hover:brightness-105',
          code: 'bg-amber-900/60 border-amber-400/40 text-amber-200',
        };
    }
  };

  // Editable section custom headings
  const defaultHeadings = {
    servicesTitle: 'Curated Services & Treatments',
    servicesSubtitle: 'Explore our handcrafted menu with transparent pricing in INR (₹).',
    stylistsTitle: 'Meet Our Master Specialists & Stylists',
    stylistsSubtitle: 'Dedicated specialists offering personalized care.',
    testimonialsTitle: 'Client Experiences',
    galleryTitle: 'Studio Lookbook & Client Transformations',
    locationTitle: 'Visit Our Sanctuary',
  };
  const sectionHeadings = { ...defaultHeadings, ...Object.fromEntries(Object.entries(activeProfile.sectionHeadings || {}).filter(([, value]) => typeof value === 'string' && value.trim())) };
  const setSectionHeadings: React.Dispatch<React.SetStateAction<typeof defaultHeadings>> = next => setProfile(p => ({
    ...p, sectionHeadings: typeof next === 'function' ? next({ ...defaultHeadings, ...p.sectionHeadings }) : next,
  }));

  // Top AI Prompt state
  const [topAiPrompt, setTopAiPrompt] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);

  // Toast message
  const [toastMessage, setToastMessage] = useState<{
    id: string;
    title: string;
    clientName: string;
    serviceName: string;
    stylistName: string;
    dateTime: string;
    refCode: string;
    price: number;
  } | null>(null);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState<boolean>(false);
  const [copiedSubdomain, setCopiedSubdomain] = useState<boolean>(false);

  const showNotification = (msg: string) => {
    setNotificationToast(msg);
    setTimeout(() => setNotificationToast(null), 3500);
  };

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 5500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Lightbox keyboard navigation (Left/Right arrow keys and Escape key)
  useEffect(() => {
    if (!selectedGalleryPhoto) return;
    const galleryPhotos = activeGalleryPhotos;
    const currentIndex = galleryPhotos.findIndex(photo => photo.url === selectedGalleryPhoto);
    if (currentIndex === -1) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedGalleryPhoto(null);
      } else if (e.key === 'ArrowLeft') {
        const prevIndex = (currentIndex - 1 + galleryPhotos.length) % galleryPhotos.length;
        setSelectedGalleryPhoto(galleryPhotos[prevIndex].url);
      } else if (e.key === 'ArrowRight') {
        const nextIndex = (currentIndex + 1) % galleryPhotos.length;
        setSelectedGalleryPhoto(galleryPhotos[nextIndex].url);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedGalleryPhoto, activeGalleryPhotos]);

  const handleCopyRefCode = async (code: string) => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    }
  };

  const subCategoriesList = ['All', ...Array.from(new Set(activeServices.map(s => s.category).filter(Boolean)))];

  const filteredServices = activeSubCategory === 'All' || !subCategoriesList.includes(activeSubCategory)
    ? activeServices
    : activeServices.filter((s) => s.category === activeSubCategory);

  // Keep the pre-selected service / stylist valid when the template changes.
  useEffect(() => {
    if (!activeServices.some((s) => s.id === selectedService?.id)) {
      setSelectedService(activeServices[0]);
    }
  }, [activeServices]);
  useEffect(() => {
    if (!activeStylists.some((st) => st.id === selectedStylist?.id)) {
      setSelectedStylist(activeStylists[0]);
    }
  }, [activeStylists]);

  // Category template switcher — delegates to the parent's single unified
  // handler (which PRESERVES the owner's input) and only re-themes the canvas.
  const handleCategorySwitch = (catId: BusinessTypeId) => {
    if (onOpenTemplateExplorer) {
      onOpenTemplateExplorer();
      return;
    }
    const tmpl = getTemplateConfig(catId);
    if (!tmpl) return;

    setIsEditMode(false);
    setActiveSubCategory('All');

    // Let the parent (App) own the merge logic so onboarding data is never lost.
    if (onSelectTemplate) {
      onSelectTemplate(catId);
    }
    if (setSelectedTemplateId) {
      setSelectedTemplateId(catId);
    }
    setSelectedCategoryKey(catId);

    const newAccent = DEFAULT_CATEGORY_ACCENTS[catId] || 'slate';
    setSelectedAccentKey(newAccent);
    setIsDarkCanvas(tmpl.themeStyle.isDark || newAccent === 'obsidian');

    if (onSelectCategory) {
      onSelectCategory(catId);
    }

    showNotification(`Switched to \"${tmpl.title}\" template — your salon details & services were kept.`);
  };

  const whatsappDigits = (activeProfile.whatsapp || '').replace(/\D/g, '');
  const bookingWhatsapp = /^\d{7,15}$/.test(whatsappDigits) ? (whatsappDigits.length === 10 ? `91${whatsappDigits}` : whatsappDigits) : '';
  const handleOpenBooking = (srv?: SalonService, stylist?: Stylist) => {
    if (previewMode) {
      showNotification('Preview Mode: This action is simulated.');
      return;
    }
    if (activeProfile.acceptsOnlineBookings === false || activeServices.length === 0) {
      showNotification('Online booking is currently unavailable. Please contact the studio.');
      return;
    }
    const serviceToBook = activeServices.find(s => s.id === srv?.id) || activeServices[0];
    const stylistToBook = activeStylists.find(s => s.id === stylist?.id);

    if (!user?.id) {
      // Keep the exact service/specialist the visitor chose while the existing
      // AuthModal is open. The effect below reopens this flow automatically
      // after a successful login/signup instead of making the visitor start
      // over.
      pendingBookingRef.current = { service: serviceToBook, stylist: stylistToBook };
      onRequireAuth?.('login');
      showNotification('Please log in or create an account to book an appointment.');
      return;
    }

    setSelectedService(serviceToBook);
    setSelectedStylist(stylistToBook);
    setIsBookingOpen(true);
  };

  const scrollToMobileSection = (id: 'home' | 'services' | 'location') => {
    setMobileNavActive(id);
    const target = document.getElementById(`${id}-section`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Complete the booking action that opened the auth dialog. This is keyed by
  // the authenticated user id, not by a client-supplied owner id.
  useEffect(() => {
    if (!user?.id || !pendingBookingRef.current) return;
    const pending = pendingBookingRef.current;
    pendingBookingRef.current = null;
    if (!activeServices.length || activeProfile.acceptsOnlineBookings === false) return;
    setSelectedService(activeServices.find(s => s.id === pending.service?.id) || activeServices[0]);
    setSelectedStylist(activeStylists.find(s => s.id === pending.stylist?.id));
    setIsBookingOpen(true);
  }, [user?.id, activeServices, activeStylists, activeProfile.acceptsOnlineBookings]);

  // Rebook from "My Bookings": pre-select the service the customer last had and
  // open the flow. `activeServices` may still be loading when the page mounts,
  // so the request is matched by name once the list arrives and then marked
  // handled — matching the guard the pending-booking effect above uses.
  useEffect(() => {
    if (!rebookRequest?.at || handledRebookAtRef.current === rebookRequest.at || !activeServices.length || activeProfile.acceptsOnlineBookings === false) return;
    handledRebookAtRef.current = rebookRequest.at;
    const match = activeServices.find((service) => service.name === rebookRequest.serviceName);
    setSelectedService(match || activeServices[0]);
    setBookingFromHistory(true);
    setIsBookingOpen(true);
  }, [rebookRequest, activeServices, activeProfile.acceptsOnlineBookings]);

  // Inline Service Actions
  const handleUpdateServicePrice = (serviceId: string, newPrice: number) => {
    if (!Number.isFinite(newPrice) || newPrice < 0) { showNotification('Enter a valid non-negative price.'); return; }
    setServices((prev) =>
      prev.map((s) => (s.id === serviceId ? { ...s, price: newPrice, originalPrice: s.originalPrice != null && s.originalPrice >= newPrice ? s.originalPrice : undefined } : s))
    );
    showNotification(`Updated service price to ₹${newPrice}`);
  };

  const handleUpdateServiceName = (serviceId: string, newName: string) => {
    setServices((prev) =>
      prev.map((s) => (s.id === serviceId ? { ...s, name: String(newName) } : s))
    );
  };

  const handleUpdateServiceDesc = (serviceId: string, newDesc: string) => {
    setServices((prev) =>
      prev.map((s) => (s.id === serviceId ? { ...s, description: String(newDesc) } : s))
    );
  };

  const handleUpdateServiceDuration = (serviceId: string, newDuration: number) => {
    if (!Number.isInteger(newDuration) || newDuration <= 0) { showNotification('Enter a positive duration in whole minutes.'); return; }
    setServices((prev) =>
      prev.map((s) => (s.id === serviceId ? { ...s, durationMinutes: Number(newDuration) } : s))
    );
  };

  const handleToggleServiceShowDuration = (serviceId: string) => {
    setServices((prev) =>
      prev.map((s) => {
        if (s.id !== serviceId) return s;
        const newShow = s.showDuration === false;
        showNotification(
          newShow
            ? `Duration will be displayed on public menu for "${s.name}".`
            : `Duration hidden on public menu for "${s.name}".`
        );
        return { ...s, showDuration: newShow };
      })
    );
  };

  const handleAddNewService = () => {
    const newSrv: SalonService = {
      id: `srv-${Date.now()}`,
      name: 'New Signature Treatment',
      category: activeSubCategory === 'All' ? (activeTemplate.subCategories[0] || 'General') : activeSubCategory,
      durationMinutes: 45,
      price: 950,
      description: 'Personalized salon care with organic essential extracts and precision styling.',
      icon: 'spa',
      popular: true
    };
    setServices((prev) => [newSrv, ...prev]);
    showNotification(`Added new service "${newSrv.name}" (₹${newSrv.price})!`);
  };

  const handleDeleteService = (serviceId: string) => {
    setServices((prev) => prev.filter((s) => s.id !== serviceId));
    showNotification('Service removed from menu.');
  };

  // Inline Stylist Actions
  const handleUpdateStylistName = (stylistId: string, newName: string) => {
    setStylists((prev) =>
      prev.map((st) => (st.id === stylistId ? { ...st, name: String(newName) } : st))
    );
  };

  const handleUpdateStylistRole = (stylistId: string, newRole: string) => {
    setStylists((prev) =>
      prev.map((st) => (st.id === stylistId ? { ...st, role: String(newRole) } : st))
    );
  };

  const handleUpdateStylistRating = (stylistId: string, newRating: number) => {
    setStylists((prev) =>
      prev.map((st) => (st.id === stylistId ? { ...st, rating: Number(newRating) } : st))
    );
  };

  const handleAddNewStylist = () => {
    const newSt: Stylist = {
      id: `st-${Date.now()}`,
      name: 'Specialist Artisan',
      role: 'Senior Hair & Beauty Expert',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
      rating: 4.9,
      specialties: ['Precision Styling', 'Color Artistry', 'Scalp Detox']
    };
    setStylists((prev) => [...prev, newSt]);
    showNotification(`Specialist "${newSt.name}" added to roster!`);
  };

  const handleDeleteStylist = (stylistId: string) => {
    setStylists((prev) => prev.filter((st) => st.id !== stylistId));
    showNotification('Specialist removed from roster.');
  };

  // Dynamic Testimonials Management Actions
  const handleAddNewTestimonial = () => {
    setEditingTestimonial(null);
    setIsTestimonialModalOpen(true);
  };

  const handleEditTestimonial = (testimonial: Testimonial) => {
    setEditingTestimonial(testimonial);
    setIsTestimonialModalOpen(true);
  };

  const handleDeleteTestimonial = (id: string) => {
    setActiveReviews((prev) => prev.filter((r) => r.id !== id));
    showNotification('Review removed from featured testimonials list.');
  };

  const handleSaveTestimonial = (saved: Testimonial) => {
    setActiveReviews((prev) => {
      const exists = prev.some((r) => r.id === saved.id);
      if (exists) {
        return prev.map((r) => r.id === saved.id ? saved : r);
      } else {
        return [saved, ...prev];
      }
    });
    showNotification(editingTestimonial ? 'Featured testimonial updated successfully!' : 'New testimonial added to website!');
  };

  // AI Studio Prompts Engine
  const handleAIGeneratePrompt = (presetType: string, customPrompt?: string) => {
    setIsAiLoading(true);
    setTimeout(() => {
      if (presetType === 'luxury') {
        setProfile((prev) => ({
          ...prev,
          tagline: `Bespoke Botanical Luxury & Haute Artistry in ${prev.city}`,
          about: `Step into ${prev.businessName}, an exclusive sanctuary where world-class precision meets restorative organic wellness. From runway-ready styling to deep ayurvedic scalp therapies, every moment is crafted to elevate your radiance.`
        }));
        setSectionHeadings((prev) => ({
          ...prev,
          servicesTitle: 'Haute Beauty & Wellness Experiences',
          servicesSubtitle: 'Uncompromising luxury treatments with transparent INR (₹) rates.'
        }));
      } else if (presetType === 'bridal') {
        setProfile((prev) => ({
          ...prev,
          tagline: `Royal Indian Bridal Makeovers & Festive Luxury Packages`,
          about: `Celebrate your milestone moments with ${prev.businessName}. Our award-winning bridal artisans specialize in HD makeup, intricate bridal hairstyles, pre-wedding skin detox, and luxury festive rejuvenation.`
        }));
        setSectionHeadings((prev) => ({
          ...prev,
          servicesTitle: 'Bridal & Festive Ceremony Menus',
          servicesSubtitle: 'Complete bespoke pre-bridal and wedding day packages in INR (₹).'
        }));
      } else if (presetType === 'ayurvedic') {
        setProfile((prev) => ({
          ...prev,
          tagline: `Authentic Ayurvedic Healing & Pure Herbal Rejuvenation`,
          about: `Rooted in ancient Vedic traditions, ${prev.businessName} brings you pure herbal infusions, therapeutic scalp detoxes, and dosha-balancing treatments administered by certified master vaidyas.`
        }));
        setSectionHeadings((prev) => ({
          ...prev,
          servicesTitle: 'Traditional Ayurvedic Rituals',
          servicesSubtitle: 'Pure herbal therapies and holistic body polishes in INR (₹).'
        }));
      } else if (presetType === 'genz') {
        setProfile((prev) => ({
          ...prev,
          tagline: `Next-Gen Hair Artistry, Bold Colors & Trendsetting Cuts`,
          about: `Welcome to ${prev.businessName}—the ultimate style destination for trendsetters. We turn hair into art with precision fades, vivid balayage, express blowouts, and aesthetic nail glam.`
        }));
      } else if (customPrompt) {
        setProfile((prev) => ({
          ...prev,
          tagline: `Elevated Salon Care Tailored for ${prev.city}`,
          about: `At ${prev.businessName}, we combine innovative techniques with personalized care inspired by "${customPrompt}". Discover customized beauty services crafted to celebrate your unique individuality.`
        }));
      }
      setIsAiLoading(false);
      showNotification('AI regenerated copy and headline variations applied to canvas!');
    }, 600);
  };

  // Device width class
  const deviceWidthClass = {
    desktop: 'w-full',
    tablet: 'max-w-[768px] w-full mx-auto shadow-2xl rounded-2xl border-2 border-slate-300',
    mobile: 'max-w-[390px] w-full mx-auto overflow-hidden shadow-2xl rounded-3xl border-[8px] border-gray-900 bg-white relative'
  }[deviceMode];

  const themeStyle = activeTemplate.themeStyle;
  const resolvedPrimaryColor = activeProfile.primaryColor || primaryAccentColor;
  const resolvedSecondaryColor = activeProfile.secondaryColor || activeAccent.secondaryHex;
  const contrastTextColor = getContrastTextColor(resolvedPrimaryColor);
  const accentLuminance = getLuminance(resolvedPrimaryColor);
  const radius = ({ none: '0px', small: '0.5rem', medium: '1rem', large: '1.5rem' }[activeProfile.borderRadius || 'medium']);
  const headingStyleClass = activeProfile.headingStyle === 'classic'
    ? '[&_h1]:font-serif [&_h2]:font-serif [&_h3]:font-serif'
    : activeProfile.headingStyle === 'editorial'
      ? '[&_h1]:tracking-tight [&_h2]:tracking-tight [&_h3]:tracking-tight'
      : activeProfile.headingStyle === 'bold'
        ? '[&_h1]:font-black [&_h2]:font-extrabold [&_h3]:font-bold'
        : '';
  const buttonStyleClass = activeProfile.buttonStyle === 'pill'
    ? '[&_button]:rounded-full'
    : activeProfile.buttonStyle === 'square'
      ? '[&_button]:rounded-none'
      : activeProfile.buttonStyle === 'soft'
        ? '[&_button]:shadow-sm'
      : '';

  // Keep the installed-PWA browser chrome aligned with the active template.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = resolvedPrimaryColor;
  }, [resolvedPrimaryColor]);

  useEffect(() => {
    if (!publicView || typeof IntersectionObserver === 'undefined') return;
    const targets = ['home', 'services', 'location']
      .map((id) => document.getElementById(`${id}-section`))
      .filter((element): element is HTMLElement => Boolean(element));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (visible) setMobileNavActive(visible.target.id.replace('-section', '') as 'home' | 'services' | 'location');
    }, { rootMargin: '-35% 0px -50% 0px', threshold: 0.01 });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [publicView, sectionVisibility.header, sectionVisibility.location]);

  return (
    <div 
      className={`min-h-dvh w-full max-w-full overflow-x-clip flex flex-col items-center text-slate-900 font-sans relative select-text ${activeProfile.appearance === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-100'} ${headingStyleClass} ${buttonStyleClass} ${publicView ? 'pt-0 pb-28 md:pb-16' : 'pt-20 pb-24'}`}
      style={{
        '--primary-accent': resolvedPrimaryColor,
        '--theme-primary': resolvedPrimaryColor,
        '--theme-secondary': resolvedSecondaryColor,
        '--color-primary': resolvedPrimaryColor,
        '--brand-background': activeProfile.backgroundColor || (activeProfile.appearance === 'dark' ? '#020617' : '#ffffff'),
        '--brand-radius': radius,
        '--accent-luminance': accentLuminance.toFixed(4),
        '--accent-text-color': contrastTextColor,
        '--accent-contrast-text': contrastTextColor,
        '--color-on-primary': contrastTextColor,
        '--theme-on-accent': contrastTextColor,
        '--heading-text-shadow': '0 1px 3px rgba(0, 0, 0, 0.45)',
      } as React.CSSProperties}
      onClickCapture={(event) => {
        if (!previewMode) return;
        const target = event.target as HTMLElement;
        if (target.closest('a')) {
          event.preventDefault();
          event.stopPropagation();
          showNotification('Preview Mode: This action is simulated.');
        }
      }}
    >
      
      {/* Toast Notifications */}
      <AnimatePresence>
        {notificationToast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="layout-stable-fixed fixed right-3 top-24 z-50 flex max-w-[calc(100vw-1.5rem)] items-center gap-2.5 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-medium text-white shadow-2xl sm:right-5"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{notificationToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================ */}
      {/* 1. TOP UNIFIED NAVIGATION & AI STUDIO CONTROLS BAR (OWNER ONLY) */}
      {/* ============================================================ */}
      {!publicView && (
      <div className="relative z-40 w-full max-w-full border-b border-slate-200 bg-white shadow-xs md:sticky md:top-20">
        <div className="mx-auto flex w-full min-w-0 max-w-[1440px] flex-col gap-2.5 p-2 sm:p-4">
          
          {/* Main Controls Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            
            {/* Left Status & Subdomain */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-700">
                <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[11px] font-bold border border-emerald-200 shrink-0">
                  LIVE
                </span>
                <span className="font-bold truncate max-w-[260px]">
                  {siteUrl || (activeProfile.customDomain ? activeProfile.customDomain : getSiteUrl(activeProfile).replace(/^https?:\/\//, ''))}
                </span>
              </div>

              {/* Copy Link */}
              <button
                type="button"
                onClick={async () => {
                  const u = siteUrl || getSiteUrl(activeProfile);
                  const ok = await copyToClipboard(u);
                  if (ok) {
                    setCopiedSubdomain(true);
                    showNotification('Live website link copied to clipboard!');
                    setTimeout(() => setCopiedSubdomain(false), 2000);
                  }
                }}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                title="Copy Website Link"
              >
                {copiedSubdomain ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                <span>{copiedSubdomain ? 'Copied' : 'Copy Link'}</span>
              </button>

              {/* Open Site */}
              <a
                href={siteUrl || getSiteUrl(activeProfile)}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition-colors shrink-0"
                title="Open Live Site"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Open Site</span>
              </a>
            </div>

            {/* Mode Switcher: Inline Edit Mode vs Preview Mode */}
            <div className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setIsEditMode(!isEditMode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  isEditMode
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Click any text, price or heading to edit inline"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Inline Edit Mode</span>
                {isEditMode && <span className="w-2 h-2 rounded-full bg-white animate-pulse" />}
              </button>

              <button
                type="button"
                onClick={() => setIsEditMode(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  !isEditMode
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Interactive preview with working links & booking"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Client Preview</span>
              </button>
            </div>

            {/* Viewport Device Switcher */}
            <div className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setDeviceMode('desktop')}
                className={`p-1.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                  deviceMode === 'desktop' ? 'bg-white shadow-xs text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Desktop View (1240px)"
              >
                <Monitor className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Desktop</span>
              </button>
              <button
                type="button"
                onClick={() => setDeviceMode('tablet')}
                className={`p-1.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                  deviceMode === 'tablet' ? 'bg-white shadow-xs text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Tablet View (768px)"
              >
                <Tablet className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Tablet</span>
              </button>
              <button
                type="button"
                onClick={() => setDeviceMode('mobile')}
                className={`p-1.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                  deviceMode === 'mobile' ? 'bg-white shadow-xs text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Mobile View (390px)"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Mobile</span>
              </button>
            </div>

            {/* Right Action Buttons */}
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {/* Customizer Side-Panel Toggle Button */}
              <button
                type="button"
                onClick={() => setIsCustomizerOpen(!isCustomizerOpen)}
                className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-bold shadow-xs transition-all sm:px-3.5 ${
                  isCustomizerOpen
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                }`}
                id="toggle-customizer-top-btn"
                aria-label="Toggle the side customizer"
              >
                <Sliders className="w-4 h-4 text-amber-500" />
                {/* Desktop-only label: on phones the icon alone opens the
                    customizer as a full-width sheet. */}
                <span className="hidden md:inline">Side Customizer</span>
              </button>

              {/* Fast Test Booking Modal Button */}
              <button
                type="button"
                onClick={() => handleOpenBooking()}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition-all hover:bg-emerald-700 sm:px-4"
                id="test-booking-flow-btn"
              >
                <CalendarCheck className="w-4 h-4" />
                <span>Test Booking (₹)</span>
              </button>
            </div>

          </div>

          {/* AI Studio & Quick Prompts Bar */}
          <div className="pt-2 border-t border-slate-100 flex flex-col md:flex-row items-stretch md:items-center gap-2 justify-between">
            {/* AI Prompt Input */}
            <div className="flex-1 flex items-center gap-2 bg-gradient-to-r from-purple-50/70 to-pink-50/70 border border-purple-200/80 rounded-xl px-3 py-1.5">
              <Sparkles className="w-4 h-4 text-purple-600 shrink-0 animate-spin" style={{ animationDuration: '6s' }} />
              <input
                type="text"
                value={topAiPrompt}
                onChange={(e) => setTopAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && topAiPrompt.trim()) {
                    handleAIGeneratePrompt('custom', topAiPrompt);
                    setTopAiPrompt('');
                  }
                }}
                placeholder="Ask AI: e.g., 'Rewrite luxury copy for Indiranagar bridal studio' or 'Add festive discount packages'..."
                className="flex-1 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 outline-none font-sans"
              />
              <button
                type="button"
                disabled={isAiLoading || !topAiPrompt.trim()}
                onClick={() => {
                  handleAIGeneratePrompt('custom', topAiPrompt);
                  setTopAiPrompt('');
                }}
                className="px-3 py-1 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-bold text-[11px] rounded-lg transition-colors flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Wand2 className="w-3 h-3" />
                <span>Generate</span>
              </button>
            </div>

            {/* Quick 1-Click AI Tone Chips */}
            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-thin md:pb-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
                AI Presets:
              </span>
              <button
                type="button"
                onClick={() => handleAIGeneratePrompt('luxury')}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer border border-slate-200"
              >
                ✨ Luxury & Organic
              </button>
              <button
                type="button"
                onClick={() => handleAIGeneratePrompt('bridal')}
                className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-800 text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer border border-rose-200"
              >
                👰 Bridal & Festive
              </button>
              <button
                type="button"
                onClick={() => handleAIGeneratePrompt('ayurvedic')}
                className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer border border-emerald-200"
              >
                🌿 Ayurvedic Glow
              </button>
              <button
                type="button"
                onClick={() => handleAIGeneratePrompt('genz')}
                className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer border border-indigo-200"
              >
                ⚡ Gen-Z Trendsetter
              </button>
            </div>
          </div>

          {/* 14 Category Template Switcher Ribbon */}
          <div className="flex flex-wrap items-center gap-2 overflow-x-auto border-t border-slate-100 pt-2 pb-1 scrollbar-thin">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">category</span>
              14 Category Templates:
            </span>
            {TEMPLATE_REGISTRY.map((template) => {
              const tmpl = template.config;
              const isSelected = tmpl.id === selectedCategoryKey;
              return (
                <button
                  key={tmpl.id}
                  onClick={() => handleCategorySwitch(tmpl.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs scale-105'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                  title={`${tmpl.title} - ${tmpl.paletteLabel}`}
                >
                  <span className="material-symbols-outlined text-sm">{tmpl.icon}</span>
                  <span>{tmpl.shortName}</span>
                </button>
              );
            })}
          </div>

        </div>
      </div>
      )}

      {/* Side-Panel Customizer Drawer (OWNER ONLY) */}
      {!publicView && (
        <SidePanelCustomizer
          isOpen={isCustomizerOpen}
          onToggle={() => setIsCustomizerOpen(!isCustomizerOpen)}
          profile={activeProfile}
          setProfile={setProfile}
          selectedCategoryKey={selectedCategoryKey}
          selectedAccentKey={selectedAccentKey}
          setSelectedAccentKey={setSelectedAccentKey}
          primaryAccentColor={primaryAccentColor}
          isDarkCanvas={isDarkCanvas}
          setIsDarkCanvas={setIsDarkCanvas}
          sectionVisibility={sectionVisibility}
          setSectionVisibility={setSectionVisibility}
          onAIGeneratePrompt={handleAIGeneratePrompt}
          onResetDefaults={() => handleCategorySwitch(selectedCategoryKey)}
          services={activeServices}
          setServices={setServices}
          onSelectCategory={handleCategorySwitch}
        />
      )}

      {/* Edit Mode Notice Banner (OWNER ONLY) */}
      {!publicView && isEditMode && (
        <div className="mt-4 w-full max-w-[1240px] min-w-0 px-4">
          <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 shadow-xs sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Inline Live Editing Active:</strong> Click directly on any text, INR (₹) price, specialist name, or section heading on the canvas below to edit in real time.
              </span>
            </div>
            <button
              onClick={() => setIsEditMode(false)}
              className="text-amber-800 hover:text-amber-950 font-bold underline shrink-0 cursor-pointer"
            >
              Switch to Client Preview
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 2. UNIFIED SALON WEBSITE PREVIEW CANVAS */}
      {/* ============================================================ */}
      <div 
        className={`mt-8 w-full max-w-full min-w-0 box-border overflow-x-hidden p-2 transition-all duration-300 sm:p-4 ${deviceWidthClass} min-h-[800px] [&_*]:max-w-full ${
          isDarkCanvas ? 'bg-[#0f0f13] text-neutral-100' : 'bg-white text-slate-900'
        }`}
        style={{
          width: '100%',
          maxWidth: deviceMode === 'mobile' ? '390px' : deviceMode === 'tablet' ? '768px' : 'none',
          boxSizing: 'border-box',
          overflowX: 'hidden',
        }}
        id="salon-website-canvas"
      >
        
        {/* ============================================================ */}
        {/* SECTION: TOP PROMOTIONAL HEADER BANNER */}
        {/* ============================================================ */}
        {activeProfile.promotionalBanner?.enabled !== false && activeProfile.promotionalBanner?.text && isWithinPromotionDates(activeProfile.promotionalBanner.startDate, activeProfile.promotionalBanner.endDate) && !bannerDismissed && (() => {
          const themeStyle = getBannerThemeClasses(activeProfile.promotionalBanner?.themePreset);
          return (
            <div 
              className={`w-full px-4 sm:px-6 py-2.5 transition-all text-xs font-medium flex flex-wrap items-center justify-between gap-2.5 z-20 ${themeStyle.container}`}
              style={activeProfile.promotionalBanner.themePreset === 'custom' ? { backgroundImage: 'none', backgroundColor: activeProfile.promotionalBanner.customBgColor || '#0f172a', color: activeProfile.promotionalBanner.customTextColor || '#ffffff' } : undefined}
              id="salon-website-promotional-header-banner"
            >
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                {activeProfile.promotionalBanner.badgeText && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono-caps font-black tracking-wider shrink-0 shadow-2xs ${themeStyle.badge}`}>
                    <InlineEditable
                      value={activeProfile.promotionalBanner.badgeText}
                      onSave={(val) => setProfile((p) => ({
                        ...p,
                        promotionalBanner: {
                          ...(p.promotionalBanner || { enabled: true, text: '' }),
                          badgeText: String(val),
                        }
                      }))}
                      isEditingActive={isEditMode}
                      label="Badge"
                    />
                  </span>
                )}
                
                <div className="truncate text-xs font-semibold leading-tight flex-1 min-w-0">
                  <InlineEditable
                    value={activeProfile.promotionalBanner.text}
                    onSave={(val) => setProfile((p) => ({
                      ...p,
                      promotionalBanner: {
                        ...(p.promotionalBanner || { enabled: true, text: '' }),
                        text: String(val),
                      }
                    }))}
                    isEditingActive={isEditMode}
                    label="Banner Announcement"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {activeProfile.promotionalBanner.discountCode && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (activeProfile.promotionalBanner?.discountCode) {
                        const ok = await copyToClipboard(activeProfile.promotionalBanner.discountCode);
                        if (ok) {
                          setPromoCodeCopied(true);
                          showNotification(`Discount code "${activeProfile.promotionalBanner.discountCode}" copied to clipboard!`);
                          setTimeout(() => setPromoCodeCopied(false), 2500);
                        }
                      }
                    }}
                    className={`px-2.5 py-1 rounded-lg border font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs ${themeStyle.code}`}
                    title="Click to copy promo code"
                    id="banner-copy-discount-code-btn"
                  >
                    <span className="opacity-80 font-normal text-[10px]">Code:</span>
                    <span className="font-extrabold tracking-wider">
                      {activeProfile.promotionalBanner.discountCode}
                    </span>
                    {promoCodeCopied ? (
                      <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                    ) : (
                      <Copy className="w-3 h-3 opacity-70 shrink-0" />
                    )}
                  </button>
                )}

                {activeProfile.promotionalBanner.buttonText && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (activeProfile.promotionalBanner?.buttonAction === 'copy' && activeProfile.promotionalBanner.discountCode) {
                        const ok = await copyToClipboard(activeProfile.promotionalBanner.discountCode);
                        if (ok) {
                          setPromoCodeCopied(true);
                          showNotification(`Discount code copied!`);
                          setTimeout(() => setPromoCodeCopied(false), 2000);
                        }
                      } else {
                        handleOpenBooking();
                      }
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer ${themeStyle.btn}`}
                    id="banner-cta-action-btn"
                  >
                    <span>{activeProfile.promotionalBanner.buttonText}</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setBannerDismissed(true)}
                  className="w-5 h-5 rounded-full hover:bg-white/20 flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity cursor-pointer ml-1"
                  title="Dismiss Banner"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })()}

        {/* ============================================================ */}
        {/* SECTION: SALON SITE NAV HEADER & STICKY BOOKING TRIGGER */}
        {/* ============================================================ */}
        {sectionVisibility.header && (
          <header className={`sticky top-0 z-30 flex min-w-0 flex-row items-center justify-between gap-2 p-2 sm:p-4 w-full overflow-hidden border-b transition-colors ${
            isDarkCanvas ? 'bg-[#121216]/95 backdrop-blur-md border-neutral-800 text-white' : 'bg-white/95 backdrop-blur-md border-slate-100 text-slate-900'
          }`}>
            <div className="flex min-w-0 max-w-full items-center gap-3">
              {activeProfile.logoUrl ? (
                <div className="relative group shrink-0">
                  <img 
                    src={activeProfile.logoUrl} 
                    alt={activeProfile.businessName} 
                    className="h-11 max-w-[170px] object-contain rounded-xl shadow-xs transition-transform group-hover:scale-105" 
                  />
                </div>
              ) : (
                <div 
                  className="w-11 h-11 rounded-xl flex items-center justify-center font-bold shadow-xs text-white shrink-0"
                  style={{ backgroundColor: activeAccent.primaryHex }}
                >
                  <span className="material-symbols-outlined text-2xl">{activeTemplate.icon}</span>
                </div>
              )}
              <div>
                <div className={`font-bold text-lg md:text-xl tracking-tight leading-snug ${isDarkCanvas ? 'text-white' : 'text-slate-900'}`}>
                  <InlineEditable
                    value={activeProfile.businessName}
                    onSave={(val) => setProfile((p) => ({ ...p, businessName: String(val) }))}
                    isEditingActive={isEditMode}
                    label="Salon Name"
                  />
                </div>
                {isVipTemplate && (
                  <div className="inline-flex items-center gap-1 mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[#d4af37]">
                    <Award className="w-3 h-3" /> VIP Black & Gold
                  </div>
                )}
                <div className={`text-[11px] flex items-center gap-1 font-mono ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-500'}`}>
                  <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate max-w-[180px] sm:max-w-md text-xs">
                    <InlineEditable
                      value={activeProfile.address}
                      onSave={(val) => setProfile((p) => ({ ...p, address: String(val) }))}
                      isEditingActive={isEditMode}
                      label="Street Address"
                    />
                    {', '}
                    <InlineEditable
                      value={activeProfile.city}
                      onSave={(val) => setProfile((p) => ({ ...p, city: String(val) }))}
                      isEditingActive={isEditMode}
                      label="City"
                    />
                  </span>
                  {!isEditMode && (
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 text-[10px] text-emerald-500 hover:text-emerald-400 hover:underline inline-flex items-center gap-0.5 shrink-0 cursor-pointer"
                      title="Open address in Google Maps"
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      <span>Map</span>
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 max-w-full items-center gap-1 sm:gap-3 text-xs flex-wrap justify-center">
              {/* SOCIAL MEDIA HEADER LINKS (Instagram, Facebook, TikTok) */}
              {(() => {
                const instagramUrl = formatInstagramUrl(siteConfig.social_links.instagram);
                const facebookUrl = formatFacebookUrl(siteConfig.social_links.facebook);
                const tiktokUrl = formatTikTokUrl(siteConfig.social_links.tiktok);

                return (
                  <div className="flex items-center gap-1 sm:gap-3 text-xs flex-wrap mr-1 sm:mr-2" id="header-social-media-links">
                    {instagramUrl ? (
                      <a
                        href={instagramUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-2xs ${
                          isDarkCanvas
                            ? 'bg-neutral-800/90 hover:bg-gradient-to-tr hover:from-amber-600 hover:to-pink-600 text-neutral-300 hover:text-white border border-neutral-700/60'
                            : 'bg-slate-100/90 hover:bg-gradient-to-tr hover:from-amber-500 hover:to-pink-500 text-slate-700 hover:text-white border border-slate-200/80 hover:border-transparent'
                        }`}
                        title={`Instagram: ${displaySocialHandle(activeProfile.instagramHandle)}`}
                        aria-label="Instagram Profile"
                      >
                        <Instagram className="w-4 h-4" />
                      </a>
                    ) : isEditMode ? (
                      <span
                        className="w-8 h-8 rounded-xl flex items-center justify-center opacity-40 border border-dashed border-pink-400 text-pink-400 text-[10px]"
                        title="Add Instagram in Salon Info editor"
                      >
                        <Instagram className="w-3.5 h-3.5" />
                      </span>
                    ) : null}

                    {facebookUrl ? (
                      <a
                        href={facebookUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-2xs ${
                          isDarkCanvas
                            ? 'bg-neutral-800/90 hover:bg-blue-600 text-neutral-300 hover:text-white border border-neutral-700/60'
                            : 'bg-slate-100/90 hover:bg-blue-600 text-slate-700 hover:text-white border border-slate-200/80 hover:border-transparent'
                        }`}
                        title={`Facebook: ${displaySocialHandle(activeProfile.facebookPage, '')}`}
                        aria-label="Facebook Page"
                      >
                        <Facebook className="w-4 h-4" />
                      </a>
                    ) : isEditMode ? (
                      <span
                        className="w-8 h-8 rounded-xl flex items-center justify-center opacity-40 border border-dashed border-blue-400 text-blue-400 text-[10px]"
                        title="Add Facebook in Salon Info editor"
                      >
                        <Facebook className="w-3.5 h-3.5" />
                      </span>
                    ) : null}

                    {tiktokUrl && (
                      <a href={tiktokUrl} target="_blank" rel="noopener noreferrer"
                        aria-label="TikTok Profile" title="TikTok"
                        className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-100 text-slate-700 hover:bg-slate-900 hover:text-white border border-slate-200 transition-colors">
                        <TikTokIcon className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                );
              })()}

              <div className="hidden lg:flex flex-col text-right">
                <span className="text-[11px] font-mono text-slate-400">Direct Appointments</span>
                <span className="text-xs font-semibold sm:text-sm font-mono">
                  <InlineEditable
                    value={activeProfile.phone}
                    onSave={(val) => setProfile((p) => ({ ...p, phone: String(val) }))}
                    isEditingActive={isEditMode}
                    label="Phone Number"
                  />
                </span>
              </div>

              {/* Header Sticky Booking Trigger */}
              <button
                type="button"
                onClick={() => handleOpenBooking()}
                className="font-bold text-xs px-5 py-2.5 rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer text-white hover:opacity-90"
                style={{ backgroundColor: activeAccent.primaryHex }}
              >
                <CalendarCheck className="w-4 h-4" />
                <span>Book Appointment</span>
              </button>
            </div>
          </header>
        )}

        {/* ============================================================ */}
        {/* 1. HERO SECTION WITH DYNAMIC AI IMAGE MOOD STYLING */}
        {/* ============================================================ */}
        {sectionVisibility.hero && (
          <section id="home-section" className="relative w-full max-w-full min-w-0 overflow-hidden transition-all bg-slate-950 text-white min-h-[480px] md:min-h-[540px] flex items-center scroll-mt-16">
            {/* Background Image & Gentle Ambient Mask (15-25% Overlay Max) */}
            <div className="absolute inset-0 z-0 overflow-hidden">
              <img
                src={heroImageSrc}
                alt={activeProfile.businessName}
                onError={(e) => {
                  if (heroImageSrc) setHeroImageSrc('');
                }}
                className={`w-full max-w-full h-full object-cover rounded-xl object-center ${heroAIStyling.imageFilterClass} transition-all duration-700 hover:scale-105`}
              />
              {/* Dynamic Overlay Ambient Tint (Gentle ~15-25% mask max) */}
              <div 
                className={`absolute inset-0 bg-black/60 md:bg-transparent ${heroAIStyling.overlayGradientClass} pointer-events-none transition-all duration-500`}
                style={{
                  backgroundColor: heroAIStyling.overlayAccentColor,
                  mixBlendMode: heroAIStyling.overlayBlendMode as any
                }}
              />
              {/* Bottom Vignette for Smooth Transition */}
              <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/80 to-transparent pointer-events-none" />
            </div>

            {/* Hero Content Container with Dynamic Backdrop Glassmorphism */}
            <div className="relative z-10 px-4 sm:px-6 md:px-12 py-10 md:py-16 max-w-4xl w-full mx-auto my-auto">
              <div className={`${heroAIStyling.cardBackingClass} transition-all duration-500`}>
                {/* Category badge & highlight tags */}
                <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-2 max-w-full mb-4 min-h-[2rem]">
                  <span 
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-bold tracking-wide uppercase shadow-xs transition-colors"
                    style={{ 
                      background: heroAIStyling.badgeBg,
                      color: heroAIStyling.badgeTextColor 
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">{activeTemplate.icon}</span>
                    <span>{activeTemplate.shortName}</span>
                  </span>

                  {isVipTemplate && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#d4af37]/15 border border-[#d4af37]/45 text-[#f6d878] text-[10px] font-mono font-bold uppercase tracking-wide">
                      <Award className="w-3 h-3" /> {activeProfile.vipExperience?.inviteOnly ? 'Invitation only' : 'Private-suite priority'}
                    </span>
                  )}

                  <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-mono transition-colors ${heroAIStyling.verifiedBadgeClass}`}>
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Verified Indian Salon</span>
                  </span>

                  <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-mono transition-colors ${heroAIStyling.cityBadgeClass}`}>
                    <MapPin className="w-3.5 h-3.5 text-amber-300" />
                    <span>{activeProfile.city}</span>
                  </span>

                  {/* AI Mood Indicator Tag */}
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-950/60 backdrop-blur-md text-amber-300 border border-amber-400/30 text-[10px] font-mono font-bold shadow-xs">
                    <Sparkles className="w-3 h-3 text-amber-300 animate-pulse" />
                    <span>AI Mood: {heroAIStyling.moodName}</span>
                  </span>
                </div>

                {/* Tagline / Heading */}
                <h1 
                  className="text-xl sm:text-3xl md:text-5xl font-bold leading-tight break-words text-center sm:text-left text-balance transition-colors duration-300"
                  style={{ 
                    color: heroAIStyling.headingColor,
                    textShadow: heroAIStyling.textShadow
                  }}
                >
                  <InlineEditable
                    value={activeProfile.tagline}
                    onSave={(val) => setProfile((p) => ({ ...p, tagline: String(val) }))}
                    isEditingActive={isEditMode}
                    label="Hero Tagline"
                    tag="span"
                  />
                </h1>

                {/* Description */}
                <p 
                  className="text-sm md:text-base mt-4 leading-relaxed max-w-2xl transition-colors duration-300"
                  style={{ 
                    color: heroAIStyling.subtitleColor,
                    textShadow: heroAIStyling.textShadow !== 'none' ? '0 1px 4px rgba(0,0,0,0.7)' : 'none'
                  }}
                >
                  <InlineEditable
                    value={activeProfile.about}
                    onSave={(val) => setProfile((p) => ({ ...p, about: String(val) }))}
                    isEditingActive={isEditMode}
                    type="textarea"
                    label="Hero Story"
                    tag="span"
                  />
                </p>

                {/* Quick Metrics Bar */}
                {sectionVisibility.metrics && (
                  <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t ${heroAIStyling.metricsBorderColor} text-xs transition-colors`}>
                    <div className="min-h-[3rem] flex flex-col justify-center">
                      <div className={`${heroAIStyling.metricsLabelColor} font-mono text-[10px] uppercase`}>Services from</div>
                      {isLoading ? (
                        <div className="h-6 w-16 bg-slate-200/50 animate-pulse rounded-lg mt-1" />
                      ) : (
                        <div className={`text-xl font-bold font-mono ${heroAIStyling.metricsValueColor}`}>
                          {minPrice !== null ? `₹${minPrice}` : '₹—'}
                        </div>
                      )}
                    </div>
                    <div className="min-h-[3rem] flex flex-col justify-center">
                      <div className={`${heroAIStyling.metricsLabelColor} font-mono text-[10px] uppercase`}>Lead Specialist</div>
                      {isLoading ? (
                        <div className="h-5 w-24 bg-slate-200/50 animate-pulse rounded-lg mt-1" />
                      ) : (
                        <div className="text-sm font-bold truncate">
                          <InlineEditable
                            value={activeProfile.ownerName}
                            onSave={(val) => setProfile((p) => ({ ...p, ownerName: String(val) }))}
                            isEditingActive={isEditMode}
                            label="Lead Specialist Name"
                          />
                        </div>
                      )}
                    </div>
                    <div className="min-h-[3rem] flex flex-col justify-center">
                      <div className={`${heroAIStyling.metricsLabelColor} font-mono text-[10px] uppercase`}>Specialty</div>
                      {isLoading ? (
                        <div className="h-5 w-20 bg-slate-200/50 animate-pulse rounded-lg mt-1" />
                      ) : (
                        <div className="text-sm font-bold truncate">{activeTemplate.subCategories[0] || 'Artistry'}</div>
                      )}
                    </div>
                    <div className="min-h-[3rem] flex flex-col justify-center">
                      <div className={`${heroAIStyling.metricsLabelColor} font-mono text-[10px] uppercase`}>Client Rating</div>
                      {isLoading ? (
                        <div className="h-5 w-28 bg-slate-200/50 animate-pulse rounded-lg mt-1" />
                      ) : (
                        <div className="text-sm font-bold flex items-center gap-1 text-amber-400">
                          <Star className="w-3.5 h-3.5 fill-amber-400" />
                          <span>{standardData.averageRating} ({standardData.totalReviewCount}+ Reviews)</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Primary Action Buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 mt-8">
                  <button
                    type="button"
                    onClick={() => handleOpenBooking()}
                    className="w-full sm:w-auto font-bold text-sm px-6 py-3.5 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
                    style={{ 
                      backgroundColor: heroAIStyling.primaryBtnBg,
                      color: heroAIStyling.primaryBtnText 
                    }}
                  >
                    <span>{isVipTemplate ? `Request ${vipLabel}` : 'Book Now'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <a
                    href={`https://wa.me/${activeProfile.whatsapp.replace(/\D/g, '')}?text=Hello%20${encodeURIComponent(activeProfile.businessName)},%20I%20would%20like%20to%20inquire%20about%20booking%20an%20appointment.`}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-5 py-3.5 rounded-xl border border-emerald-400/30 flex items-center gap-2 transition-all cursor-pointer shadow-md"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>WhatsApp Us ({activeProfile.whatsapp})</span>
                  </a>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Location Banner Bar with Live Hours */}
        <div data-layout-stable-location className={`px-6 py-3 flex min-h-[4.75rem] flex-wrap md:flex-nowrap items-center justify-between gap-3 text-xs border-b [contain:layout] ${
          isDarkCanvas ? 'bg-[#15151c] border-neutral-800 text-neutral-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-8 min-w-0 flex-1 items-center gap-2 group hover:opacity-90 transition-opacity cursor-pointer text-inherit"
            title="Click to show location on Google Maps"
          >
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
              <MapPin className="w-3.5 h-3.5" />
            </span>
            <span>
              <strong>Salon Location:</strong>{' '}
              {isLoading ? (
                <span className="inline-block h-3 w-40 bg-slate-200/50 animate-pulse rounded-md align-middle" />
              ) : (
                <span className="group-hover:underline underline-offset-2 decoration-emerald-500/60">
                  {formattedAddress || 'Salon Location'}
                </span>
              )}
              {!isLoading && (
                <span className="ml-2 text-[10px] text-emerald-600 font-bold inline-flex items-center gap-0.5">
                  (View on Google Maps ↗)
                </span>
              )}
            </span>
          </a>

          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>{activeProfile.workingHoursMonFri ? `Weekdays: ${activeProfile.workingHoursMonFri}` : 'Contact studio for opening hours'}</span>
            </span>
            <span className="hidden sm:inline text-slate-400">•</span>
            <span className="hidden sm:inline text-slate-500">Walk-ins & Advance Bookings</span>
          </div>
        </div>

        {/* ============================================================ */}
        {/* 2. ABOUT SALON SECTION (STORY, HYGIENE CERTIFICATIONS) */}
        {/* ============================================================ */}
        {sectionVisibility.about && (
          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className={`p-6 md:p-12 border-b ${
            isDarkCanvas ? 'bg-[#121216] border-neutral-800' : 'bg-white border-slate-200'
          }`}>
            <div className="max-w-4xl mx-auto">
              {/* Header */}
              <div className="text-center mb-8">
                <span 
                  className="text-xs font-mono font-bold uppercase tracking-wider px-3 py-1 rounded-full inline-block mb-2"
                  style={{ backgroundColor: `${activeAccent.primaryHex}18`, color: activeAccent.primaryHex }}
                >
                  About Our Sanctuary
                </span>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                  Artistry, Certified Hygiene & Pure Craftsmanship
                </h2>
                <p className={`text-xs md:text-sm mt-2 max-w-2xl mx-auto leading-relaxed ${
                  isDarkCanvas ? 'text-neutral-400' : 'text-slate-600'
                }`}>
                  <InlineEditable
                    value={activeProfile.about}
                    onSave={(val) => setProfile((p) => ({ ...p, about: String(val) }))}
                    isEditingActive={isEditMode}
                    type="textarea"
                    label="Business Story"
                  />
                </p>
              </div>

              {activeProfile.foundingYear && <p className="mb-5 text-center text-sm opacity-70">Established {activeProfile.foundingYear}</p>}
              {/* Specialties Badges */}
              <div className="flex flex-wrap justify-center gap-2 mb-10">
                {(standardData.specialties || []).map((spec, idx) => (
                  <span
                    key={idx}
                    className={`text-xs font-medium px-3.5 py-1.5 rounded-xl border flex items-center gap-1.5 ${
                      isDarkCanvas ? 'bg-neutral-900 border-neutral-800 text-neutral-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>{spec}</span>
                  </span>
                ))}
              </div>

              {/* Founder / Lead Stylist Quote Card */}
              <div className={`p-6 rounded-2xl border mb-10 flex flex-col sm:flex-row items-center gap-5 ${
                isDarkCanvas ? 'bg-neutral-900/70 border-neutral-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="relative shrink-0">
                  <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 shadow-sm" style={{ borderColor: activeAccent.primaryHex }}>
                    <img
                      src={activeProfile.ownerPhotoUrl || '/nexora-salonos-logo.png'}
                      alt={displayOwnerName}
                      className="w-full h-full object-cover bg-slate-950"
                    />
                  </div>
                  <span className="absolute -bottom-2 -right-2 bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-xs">
                    Lead
                  </span>
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <p className={`text-xs italic leading-relaxed ${isDarkCanvas ? 'text-neutral-300' : 'text-slate-700'}`}>
                    {activeProfile.ownerBio || `Welcome to ${activeProfile.businessName}. We offer personal consultations and thoughtful care tailored to every guest.`}
                  </p>
                  <div className="mt-2">
                    <span className="font-bold text-sm block">
                      <InlineEditable
                        value={displayOwnerName}
                        onSave={(val) => setProfile((p) => ({ ...p, ownerName: String(val) }))}
                        isEditingActive={isEditMode}
                        label="Founder Name"
                      />
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      <InlineEditable
                        value={activeProfile.ownerRole}
                        onSave={(val) => setProfile((p) => ({ ...p, ownerRole: String(val) }))}
                        isEditingActive={isEditMode}
                        label="Founder Role"
                      />
                    </span>
                    {activeProfile.ownerExperience && <p className="mt-2 text-sm">{activeProfile.ownerExperience}</p>}
                    {activeProfile.ownerQualifications && <p className="mt-1 text-xs opacity-70">{activeProfile.ownerQualifications}</p>}
                    <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
                      {activeProfile.phone && <a href={`tel:${activeProfile.phone}`}>Contact studio: {activeProfile.phone}</a>}
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 Hygiene & Quality Certification Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(standardData.certifications || []).map((cert, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl border flex items-start gap-3.5 transition-all ${
                      isDarkCanvas ? 'bg-neutral-900/50 border-neutral-800 hover:border-neutral-700' : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                    }`}
                  >
                    <div 
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-white"
                      style={{ backgroundColor: activeAccent.primaryHex }}
                    >
                      <span className="material-symbols-outlined text-lg">{cert.icon}</span>
                    </div>
                    <div>
                      <h3 className="font-bold text-xs md:text-sm">{cert.title}</h3>
                      <p className={`text-xs mt-1 leading-relaxed ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-500'}`}>
                        {cert.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </motion.section>
        )}

        {/* ============================================================ */}
        {/* 3. SERVICES & PRICING MENU SECTION (100% INLINE EDITABLE) */}
        {/* ============================================================ */}
        {sectionVisibility.services && (
          <section className={`px-4 py-6 sm:p-6 md:p-12 border-b ${
            isDarkCanvas ? 'bg-[#0f0f13] border-neutral-800' : 'bg-white border-slate-200'
          }`} id="services-section">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span 
                    className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: `${activeAccent.primaryHex}18`, color: activeAccent.primaryHex }}
                  >
                    {activeTemplate.title} Menu
                  </span>
                  <span className="text-xs text-slate-400 font-mono">({filteredServices.length} Treatments)</span>
                </div>

                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">
                  <InlineEditable
                    value={sectionHeadings.servicesTitle}
                    onSave={(val) => setSectionHeadings((prev) => ({ ...prev, servicesTitle: String(val) }))}
                    isEditingActive={isEditMode}
                    label="Services Section Heading"
                    tag="span"
                  />
                </h2>

                <p className={`text-xs md:text-sm mt-1 ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-500'}`}>
                  <InlineEditable
                    value={sectionHeadings.servicesSubtitle}
                    onSave={(val) => setSectionHeadings((prev) => ({ ...prev, servicesSubtitle: String(val) }))}
                    isEditingActive={isEditMode}
                    label="Services Section Subtitle"
                    tag="span"
                  />
                </p>
              </div>
            </div>

            {/* Elegant Tabbed Navigation Bar for Categories */}
            <div className="mt-8 mb-8 border-b border-slate-100 dark:border-neutral-800 pb-2 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                {subCategoriesList.map((subCat) => {
                  const isActive = activeSubCategory === subCat;
                  return (
                    <button
                      key={subCat}
                      type="button"
                      onClick={() => setActiveSubCategory(subCat)}
                      className={`text-xs md:text-sm font-extrabold px-4 py-2.5 rounded-xl transition-all relative whitespace-nowrap cursor-pointer ${
                        isActive
                          ? 'text-slate-900 bg-slate-100 dark:bg-neutral-800 dark:text-white shadow-xs'
                          : 'text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-200'
                      }`}
                    >
                      <span>{subCat}</span>
                      {isActive && (
                        <motion.div
                          layoutId="activeServiceTab"
                          className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                          style={{ backgroundColor: activeAccent.primaryHex }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {isEditMode && (
                <button
                  type="button"
                  onClick={handleAddNewService}
                  className="text-xs font-bold px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors shrink-0"
                  title="Add new custom service to menu"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Service</span>
                </button>
              )}
            </div>

            {/* Services Grid */}
            <div
              key={activeSubCategory}
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              {filteredServices.map((srv, idx) => (
                <div
                  key={`${activeSubCategory}-${srv.id}`}
                  style={{ animationDelay: `${Math.min(idx * 50, 400)}ms` }}
                  className={`animate-service-enter p-5 rounded-2xl border transition-all duration-300 ease-out flex flex-col justify-between gap-4 group cursor-pointer hover:-translate-y-1 hover:shadow-lg ${
                    isDarkCanvas
                      ? 'bg-neutral-900/80 border-neutral-800 hover:border-neutral-700 hover:shadow-black/50'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs hover:shadow-slate-200/80'
                  }`}
                >
                  <img src={srv.imageUrl || serviceImageFallback(selectedCategoryKey)} alt={srv.name} loading="lazy" className="h-48 w-full rounded-xl object-cover"
                    onError={event => { const img = event.currentTarget; const fallback = serviceImageFallback(selectedCategoryKey); if (!img.src.endsWith('/service-placeholder.svg')) img.src = img.src === fallback ? '/service-placeholder.svg' : fallback; }} />
                  {isEditMode && <ContentImageField label="Service image" value={srv.imageUrl} onChange={imageUrl => setServices(prev => prev.map(s => s.id === srv.id ? { ...s, imageUrl } : s))} />}
                  {isEditMode && <div className="grid grid-cols-2 gap-2"><ServicePriceFields service={srv} onChange={patch => setServices(prev => prev.map(s => s.id === srv.id ? { ...s, ...patch } : s))} /></div>}
                  <div className="flex items-start gap-4 justify-between">
                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                      {/* Service Icon Container */}
                      <div 
                        className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border transition-transform duration-300 ease-out group-hover:scale-110 group-hover:rotate-1 ${
                          isDarkCanvas
                            ? 'bg-neutral-800/50 border-neutral-700/60 text-white'
                            : 'bg-slate-50 border-slate-100'
                        }`}
                        style={{ color: activeAccent.primaryHex }}
                      >
                        {React.createElement(getServiceIcon(srv.icon), { className: "w-6 h-6 shrink-0 transition-transform duration-300 group-hover:scale-105" })}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className={`font-extrabold text-base md:text-lg leading-snug transition-colors duration-200 ${
                            isDarkCanvas ? 'text-white group-hover:text-emerald-300' : 'text-slate-900 group-hover:text-emerald-700'
                          }`}>
                            <InlineEditable
                              value={srv.name}
                              onSave={(val) => handleUpdateServiceName(srv.id, String(val))}
                              isEditingActive={isEditMode}
                              label="Service Name"
                            />
                          </h3>
                          {srv.popular && (
                            <span 
                              className="text-[10px] font-mono font-extrabold px-2.5 py-0.5 rounded-full border border-white/20 shadow-xs shrink-0 tracking-wider uppercase transition-transform duration-200 group-hover:scale-105 inline-flex items-center gap-1"
                              style={{ backgroundColor: activeAccent.primaryHex, color: 'var(--accent-text-color, #ffffff)' }}
                            >
                              <Sparkles className="w-2.5 h-2.5 shrink-0" />
                              <span>POPULAR</span>
                            </span>
                          )}
                        </div>

                        <p className={`text-xs mt-1.5 leading-relaxed font-medium ${
                          isDarkCanvas ? 'text-neutral-300' : 'text-slate-600'
                        }`}>
                          <InlineEditable
                            value={isEditMode || srv.description.length <= 150 ? srv.description : `${srv.description.slice(0, 147).trimEnd()}…`}
                            onSave={(val) => handleUpdateServiceDesc(srv.id, String(val))}
                            isEditingActive={isEditMode}
                            type="textarea"
                            label="Service Description"
                          />
                        </p>
                      </div>
                    </div>

                    {/* Price & Duration Elegant Badge System */}
                    <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                      <div className="flex items-center gap-2 justify-end flex-wrap">
                        <div className={`text-lg md:text-xl font-extrabold font-mono transition-transform duration-200 origin-right group-hover:scale-105 ${
                          isDarkCanvas ? 'text-emerald-400' : 'text-emerald-700'
                        }`}>
                          {srv.originalPrice != null && srv.originalPrice > srv.price && <del className="mr-2 text-sm font-normal opacity-60" aria-label="Original price">₹{srv.originalPrice.toLocaleString('en-IN')}</del>}
                          <InlineEditable
                            value={srv.price}
                            onSave={(val) => handleUpdateServicePrice(srv.id, Number(val))}
                            isEditingActive={isEditMode}
                            type="price"
                            prefix="₹"
                            label="Service Price (INR)"
                            className="font-mono font-extrabold"
                          />
                        </div>

                        {/* Duration Badge directly next to Price */}
                        {(srv.showDuration !== false || isEditMode) && (
                          <div className={`text-[11px] font-mono flex items-center gap-1 px-2.5 py-1 rounded-full border shrink-0 transition-all duration-200 group-hover:scale-102 ${
                            srv.showDuration === false 
                              ? 'text-amber-800 bg-amber-50 border-amber-200' 
                              : isDarkCanvas
                              ? 'text-neutral-200 bg-neutral-800 border-neutral-700 group-hover:border-neutral-600'
                              : 'text-slate-700 bg-slate-100 border-slate-200 group-hover:border-slate-300'
                          }`}>
                            <Clock className="w-3 h-3 text-slate-500 dark:text-neutral-400 shrink-0 transition-transform duration-300 group-hover:rotate-12" />
                            <InlineEditable
                              value={srv.durationMinutes}
                              onSave={(val) => handleUpdateServiceDuration(srv.id, Number(val))}
                              isEditingActive={isEditMode}
                              type="number"
                              suffix=" mins"
                              label="Duration"
                              className="font-semibold"
                            />
                            {isEditMode && srv.showDuration === false && (
                              <span className="text-[9px] font-mono font-bold text-amber-700 ml-0.5">
                                (Hidden)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar inside Card */}
                  <div className={`flex items-center justify-between pt-3 border-t text-xs ${
                    isDarkCanvas ? 'border-neutral-800' : 'border-slate-100'
                  }`}>
                    <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md border transition-colors duration-200 ${
                      isDarkCanvas
                        ? 'bg-neutral-800 border-neutral-700 text-neutral-300 group-hover:border-neutral-600'
                        : 'bg-slate-100 border-slate-200 text-slate-700 group-hover:border-slate-300'
                    }`}>
                      Category: {srv.category}
                    </span>

                    <div className="flex items-center gap-2">
                      {isEditMode && (
                        <>
                          {/* Visual toggle switch for showDuration */}

                          <button
                            type="button"
                            onClick={() => handleDeleteService(srv.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                            title="Delete Service"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      {activeProfile.acceptsOnlineBookings === false ? <a
                        href={bookingWhatsapp ? `https://wa.me/${bookingWhatsapp}?text=${encodeURIComponent(`Hello ${activeProfile.businessName}, I would like to book ${srv.name} (${srv.durationMinutes} mins) for ₹${srv.price}.`)}` : '#location-section'}
                        target={bookingWhatsapp ? '_blank' : undefined} rel={bookingWhatsapp ? 'noopener noreferrer' : undefined}
                        onClick={event => { if (previewMode) { event.preventDefault(); showNotification('Preview Mode: This action is simulated.'); } }}
                        className="font-extrabold px-3.5 py-2 rounded-xl text-xs flex items-center gap-1.5 hover:opacity-90"
                        style={{ backgroundColor: activeAccent.primaryHex, color: 'var(--accent-text-color, #ffffff)' }}
                      ><MessageSquare className="w-3.5 h-3.5" />{bookingWhatsapp ? 'Book on WhatsApp' : 'Contact to book'}</a> : <button
                        type="button"
                        onClick={() => handleOpenBooking(srv)}
                        className="font-extrabold px-3.5 py-2 rounded-xl text-xs shadow-xs transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-1.5 cursor-pointer hover:opacity-95 hover:shadow-md group-hover:shadow-sm"
                        style={{ backgroundColor: activeAccent.primaryHex, color: 'var(--accent-text-color, #ffffff)' }}
                      >
                        <CalendarCheck className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                        <span>Book (₹{srv.price})</span>
                      </button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/* OFFERS & DISCOUNTS SECTION */}
        {/* ============================================================ */}
        {sectionVisibility.offers && visibleOffers.length > 0 && (
          <section className={`p-6 md:p-12 border-b ${
            isDarkCanvas ? 'bg-[#0f0f13] border-neutral-800' : 'bg-white border-slate-200'
          }`} id="offers-section">
            <div className="mb-8">
              <span 
                className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                style={{ backgroundColor: `${activeAccent.primaryHex}18`, color: activeAccent.primaryHex }}
              >
                Promotions & Campaigns
              </span>
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">
                Special Offers & Discounts
              </h2>
              <p className={`text-xs md:text-sm mt-1 ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-500'}`}>
                Grab these exclusive limited-time deals and save on your next luxury pampering session.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              {visibleOffers.map((offer) => (
                <SalonOfferCard key={offer.id} offer={offer} isDarkCanvas={isDarkCanvas} />
              ))}
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/* 4. MASTER STYLISTS & SPECIALISTS SECTION (INLINE EDITABLE) */}
        {/* ============================================================ */}
        {sectionVisibility.stylists && (
          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className={`px-4 py-6 sm:p-6 md:p-12 border-b ${
            isDarkCanvas ? 'bg-[#121216] border-neutral-800' : 'bg-slate-50/50 border-slate-200'
          }`} id="team-section">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
              <div>
                <span 
                  className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: `${activeAccent.primaryHex}18`, color: activeAccent.primaryHex }}
                >
                  Our Specialist Team
                </span>

                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">
                  <InlineEditable
                    value={sectionHeadings.stylistsTitle}
                    onSave={(val) => setSectionHeadings((prev) => ({ ...prev, stylistsTitle: String(val) }))}
                    isEditingActive={isEditMode}
                    label="Stylists Section Heading"
                    tag="span"
                  />
                </h2>

                <p className={`text-xs md:text-sm mt-1 ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-500'}`}>
                  <InlineEditable
                    value={sectionHeadings.stylistsSubtitle}
                    onSave={(val) => setSectionHeadings((prev) => ({ ...prev, stylistsSubtitle: String(val) }))}
                    isEditingActive={isEditMode}
                    label="Stylists Section Subtitle"
                    tag="span"
                  />
                </p>
              </div>

              {isEditMode && (
                <button
                  type="button"
                  onClick={handleAddNewStylist}
                  className="text-xs font-bold px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Specialist</span>
                </button>
              )}
            </div>

            {/* Stylists Grid */}
            <motion.div 
              variants={{
                hidden: { opacity: 0 },
                show: {
                  opacity: 1,
                  transition: { staggerChildren: 0.1 }
                }
              }}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="grid w-full min-w-0 grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3"
            >
              {activeStylists.map((st) => (
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 10 },
                    show: { opacity: 1, y: 0 }
                  }}
                  key={st.id}
                  className={`w-full min-w-0 rounded-2xl border p-4 sm:p-5 flex flex-col justify-between gap-4 transition-all shadow-xs ${
                    isDarkCanvas ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex w-full min-w-0 items-start gap-3.5">
                    <div className="relative shrink-0">
                      <img
                        src={st.avatarUrl}
                        alt={st.name}
                        className="w-16 h-16 rounded-2xl object-cover border border-slate-100 shadow-xs"
                      />
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <h3 className={`font-extrabold text-base truncate ${isDarkCanvas ? 'text-white' : 'text-slate-900'}`}>
                          <InlineEditable
                            value={st.name}
                            onSave={(val) => handleUpdateStylistName(st.id, String(val))}
                            isEditingActive={isEditMode}
                            label="Specialist Name"
                          />
                        </h3>
                        <div className={`flex items-center gap-1 border px-2 py-0.5 rounded-lg text-xs font-extrabold shrink-0 ${
                          isDarkCanvas
                            ? 'bg-amber-950/80 border-amber-500/60 text-amber-200'
                            : 'bg-amber-100/90 border-amber-300 text-amber-950 shadow-2xs'
                        }`}>
                          <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-600 shrink-0" />
                          <InlineEditable
                            value={st.rating}
                            onSave={(val) => handleUpdateStylistRating(st.id, Number(val))}
                            isEditingActive={isEditMode}
                            type="number"
                            label="Rating"
                          />
                        </div>
                      </div>

                      <p className={`text-xs font-semibold truncate mt-1 ${isDarkCanvas ? 'text-neutral-300' : 'text-slate-600'}`}>
                        <InlineEditable
                          value={st.role}
                          onSave={(val) => handleUpdateStylistRole(st.id, String(val))}
                          isEditingActive={isEditMode}
                          label="Specialist Role"
                        />
                      </p>

                      <div className={`flex items-center gap-1.5 text-[11px] font-bold mt-1.5 ${isDarkCanvas ? 'text-emerald-400' : 'text-emerald-700'}`}>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                        <span>Accepting Online Bookings</span>
                      </div>
                    </div>
                  </div>

                  {/* Specialties tags */}
                  <div className={`pt-2.5 border-t flex flex-wrap gap-1.5 ${isDarkCanvas ? 'border-neutral-800' : 'border-slate-100'}`}>
                    {st.specialties && st.specialties.map((spec, i) => (
                      <span
                        key={i}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${
                          isDarkCanvas
                            ? 'bg-neutral-800/80 border-neutral-700 text-neutral-200'
                            : 'bg-slate-100 border-slate-200/80 text-slate-800'
                        }`}
                      >
                        {spec}
                      </span>
                    ))}
                  </div>

                  {/* Book / Manage */}
                  <div className={`w-full min-w-0 pt-2.5 border-t flex items-center justify-between gap-2 ${isDarkCanvas ? 'border-neutral-800' : 'border-slate-100'}`}>
                    {isEditMode && (
                      <button
                        type="button"
                        onClick={() => handleDeleteStylist(st.id)}
                        className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition-colors shrink-0 cursor-pointer"
                        title="Delete specialist"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenBooking(undefined, st)}
                      className="min-h-11 w-full min-w-0 whitespace-nowrap text-xs font-extrabold px-4 py-2.5 rounded-xl shadow-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all hover:opacity-90 active:scale-[0.98]"
                      style={{
                        backgroundColor: isDarkCanvas ? '#ffffff' : activeAccent.primaryHex,
                        color: isDarkCanvas ? '#0f172a' : 'var(--accent-text-color, #ffffff)',
                      }}
                    >
                      <span>Select for Service</span>
                      <ChevronRight className="w-4 h-4 shrink-0" />
                    </button>
                  </div>

                </motion.div>
              ))}
            </motion.div>
          </motion.section>
        )}

        {/* ============================================================ */}
        {/* 5. CLIENT REVIEWS & TESTIMONIALS SECTION */}
        {/* ============================================================ */}
        {sectionVisibility.testimonials && (
          <section className={`px-4 py-6 sm:p-6 md:p-12 border-b ${
            isDarkCanvas ? 'bg-[#0f0f13] border-neutral-800' : 'bg-white border-slate-200'
          }`}>
            <div className="text-center max-w-3xl mx-auto mb-8">
              <span 
                className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                style={{ backgroundColor: `${activeAccent.primaryHex}18`, color: activeAccent.primaryHex }}
              >
                Client Trust & Testimonials
              </span>
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">
                <InlineEditable
                  value={sectionHeadings.testimonialsTitle}
                  onSave={(val) => setSectionHeadings((prev) => ({ ...prev, testimonialsTitle: String(val) }))}
                  isEditingActive={isEditMode}
                  label="Reviews Section Heading"
                  tag="span"
                />
              </h2>
              <p className={`text-xs md:text-sm mt-1 ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-500'}`}>
                Verified Google & Practo reviews from clients across {activeProfile.city}.
              </p>

              {isEditMode && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={handleAddNewTestimonial}
                    className="px-4 py-2 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-xl transition-all shadow-xs hover:shadow-md hover:scale-105 active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Featured Review</span>
                  </button>
                </div>
              )}
            </div>

            <div className="grid w-full max-w-full grid-cols-1 gap-4 md:grid-cols-3">
              {(activeReviews || []).length > 0 && (
                <div
                  className={`flex w-full min-w-0 max-w-full flex-col justify-between gap-3 rounded-2xl border p-4 sm:p-5 transition-all ${
                    isDarkCanvas ? 'bg-neutral-900/60 border-neutral-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-0.5 text-amber-400">
                        {Array.from({ length: currentReview.rating || 5 }).map((_, i) => (
                          <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
                        ))}
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">{currentReview.date}</span>
                    </div>

                    <p className={`break-words text-left text-sm italic leading-relaxed ${isDarkCanvas ? 'text-neutral-300' : 'text-slate-700'}`}>
                      "{currentReview.comment}"
                    </p>
                  </div>

                  <div>
                    <div className="pt-3 border-t border-slate-200/60 dark:border-neutral-800 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-slate-100 border border-slate-200/80">
                          {currentReview.avatarUrl ? (
                            <img 
                              src={currentReview.avatarUrl}
                              alt={currentReview.name}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs uppercase">
                              {currentReview.name.charAt(0)}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-xs">{currentReview.name}</div>
                          <div className="text-[10px] text-slate-400">{currentReview.location || activeProfile.city} • Verified</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 max-w-[120px] truncate">
                        {currentReview.serviceName || 'Custom Service'}
                      </span>
                    </div>

                    {isEditMode && (
                      <div className="mt-3 pt-2.5 border-t border-slate-150 dark:border-neutral-800 flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleEditTestimonial(currentReview)}
                          className="px-2 py-1 text-[10px] font-bold text-slate-600 hover:text-amber-700 hover:bg-amber-50 bg-white border border-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTestimonial(currentReview.id)}
                          className="px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50 hover:border-rose-200 bg-white border border-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/* 6. STUDIO GALLERY & LOOKBOOK PHOTOS */}
        {/* ============================================================ */}
        {sectionVisibility.gallery && (
          <section className={`p-6 md:p-12 border-b ${
            isDarkCanvas ? 'bg-[#121216] border-neutral-800' : 'bg-slate-50/50 border-slate-200'
          }`}>
            <div className="flex items-end justify-between mb-6">
              <div>
                <span 
                  className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: `${activeAccent.primaryHex}18`, color: activeAccent.primaryHex }}
                >
                  Visual Lookbook
                </span>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">
                  <InlineEditable
                    value={sectionHeadings.galleryTitle}
                    onSave={(val) => setSectionHeadings((prev) => ({ ...prev, galleryTitle: String(val) }))}
                    isEditingActive={isEditMode}
                    label="Gallery Section Heading"
                    tag="span"
                  />
                </h2>
              </div>
              <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                Follow @{activeProfile.instagramHandle?.replace('@', '')} on Instagram
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {activeGalleryPhotos.map((photo, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedGalleryPhoto(photo.url)}
                  className="group relative rounded-xl overflow-hidden aspect-4/3 cursor-pointer shadow-md hover:shadow-xl border border-slate-100 dark:border-neutral-800 transition-all duration-300"
                >
                  <img
                    src={photo.url}
                    alt={photo.title || 'Salon Gallery Photo'}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-between p-3.5 text-white">
                    <div className="self-end bg-black/40 backdrop-blur-md p-1.5 rounded-full scale-75 group-hover:scale-100 transition-transform duration-300">
                      <ZoomIn className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-300 bg-white/10 px-2 py-0.5 rounded-full backdrop-blur-xs">
                        {photo.tag || 'Transformation'}
                      </span>
                      <h4 className="text-xs font-extrabold mt-1.5 truncate text-white drop-shadow-md">
                        {photo.title || 'Salon View'}
                      </h4>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 7.5 Social Proof & Reels Showcase */}
        {sectionVisibility.gallery && ((activeProfile.socialVideos?.length || 0) > 0 || isEditMode) && (
          <section data-layout-stable-media className={`layout-stable-media min-h-[42rem] p-6 md:p-12 border-b ${isDarkCanvas ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-slate-200'}`}>
            <div className="max-w-7xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-extrabold mb-2">Featured Videos &amp; Reels</h2>
              <p className="text-sm opacity-70 mb-8">Studio stories, signature treatments and transformations on film.</p>
              {isEditMode && <div className="mb-6"><YouTubeVideoEditor profile={activeProfile} setProfile={setProfile} templateId={selectedCategoryKey} /></div>}
              <WebsiteVideoShowcase videos={activeProfile.socialVideos ?? []} dark={isDarkCanvas} />
            </div>
          </section>
        )}

        {sectionVisibility.location && (
          <section id="location-section" className="scroll-mt-16 px-4 py-6 sm:p-6 md:p-12 bg-slate-50 border-t border-slate-100">
            <div data-layout-stable-contact className="grid grid-cols-1 lg:min-h-[36rem] lg:grid-cols-2 gap-6 [contain:layout]">
              {/* Location details */}
              <div className="flex flex-col justify-between gap-4">
                <div>
                  <span 
                    className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: `${activeAccent.primaryHex}18`, color: activeAccent.primaryHex }}
                  >
                    Find Us
                  </span>
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1 text-slate-900">
                    <InlineEditable
                      value={sectionHeadings.locationTitle}
                      onSave={(val) => setSectionHeadings((prev) => ({ ...prev, locationTitle: String(val) }))}
                      isEditingActive={isEditMode}
                      label="Location Section Heading"
                      tag="span"
                    />
                  </h2>
                  <p className="text-xs md:text-sm mt-1 leading-relaxed text-slate-700">
                    Conveniently located in the heart of {activeProfile.city}. Free parking and valet available for salon clients.
                  </p>
                </div>

                <div className="flex flex-col gap-3 text-xs">
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-20 items-start gap-3 group hover:opacity-90 transition-opacity cursor-pointer text-inherit"
                    title="Click to view studio location on Google Maps"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 text-sm group-hover:text-emerald-700 flex items-center gap-1.5">
                        <span>Studio Address</span>
                        <span className="text-[11px] font-medium text-emerald-600 font-sans inline-flex items-center gap-0.5">
                          (View on Google Maps ↗)
                        </span>
                      </div>
                      <div className="text-slate-900 font-medium text-xs mt-0.5 group-hover:underline underline-offset-2 decoration-emerald-500/50">
                        {activeProfile.address}, {activeProfile.city} - {activeProfile.postalCode}
                      </div>
                      {(activeProfile.landmark || standardData.landmark) && (
                        <div className="text-[11px] text-slate-800 mt-1 font-semibold bg-slate-100 px-2 py-0.5 rounded border border-slate-200 inline-block">
                          Landmark: {activeProfile.landmark || standardData.landmark}
                        </div>
                      )}
                    </div>
                  </a>

                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 text-sm">Operating Hours</div>
                      <div className="text-slate-900 font-mono text-[11.5px] mt-0.5 font-semibold">
                        Monday – Friday: {activeProfile.workingHoursMonFri || (previewMode ? `${standardData.openHourText} – ${standardData.closeHourText}` : 'Contact studio for hours')}
                      </div>
                      <div className="text-slate-900 font-mono text-[11.5px] font-semibold mt-0.5">
                        Saturday: {activeProfile.workingHoursSat || 'Contact studio for hours'}<br />Sunday: {activeProfile.workingHoursSun || 'Contact studio for hours'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Phone className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 text-sm">Phone & Instant WhatsApp</div>
                      <div className="text-slate-900 font-mono font-semibold text-xs mt-0.5">
                        {activeProfile.phone || activeProfile.whatsapp}
                      </div>
                      
                      {activeProfile.email && <a href={`mailto:${activeProfile.email}`} className="mt-2 block text-xs underline">{activeProfile.email}</a>}
                      {activeProfile.homeService?.enabled && <p className="mt-2 text-xs">Home visits: ₹{activeProfile.homeService.baseCharge} travel charge within {activeProfile.homeService.radiusLimitKm} km. Contact the studio to arrange.</p>}
                      {/* Social Links in Contact Section */}
                      <div className="flex items-center gap-2 mt-3">
                        {activeProfile.instagramHandle && (
                          <a 
                            href={formatInstagramUrl(siteConfig.social_links.instagram)}
                            target="_blank" 
                            rel="noreferrer" 
                            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-pink-100 text-slate-600 hover:text-pink-600 flex items-center justify-center transition-colors"
                            title="Instagram"
                          >
                            <Instagram className="w-4 h-4" />
                          </a>
                        )}
                        {activeProfile.facebookPage && (
                          <a 
                            href={formatFacebookUrl(siteConfig.social_links.facebook)}
                            target="_blank" 
                            rel="noreferrer" 
                            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-600 flex items-center justify-center transition-colors"
                            title="Facebook"
                          >
                            <Facebook className="w-4 h-4" />
                          </a>
                        )}
                        {activeProfile.youtubeChannel && (
                          <a 
                            href={activeProfile.youtubeChannel} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 flex items-center justify-center transition-colors"
                            title="YouTube"
                          >
                            <Youtube className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleOpenBooking()}
                    className="font-bold text-xs px-5 py-2.5 rounded-xl text-white shadow-xs cursor-pointer hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: activeAccent.primaryHex }}
                  >
                    Schedule Your Appointment
                  </button>

                  <a
                    href={googleDirectionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer bg-white shadow-xs transition-colors"
                    title="Get directions on Google Maps"
                  >
                    <Navigation className="w-3.5 h-3.5 text-blue-600" />
                    <span>Get Directions</span>
                  </a>

                  <a
                    href={`https://wa.me/${activeProfile.whatsapp.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer bg-white shadow-xs transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    <span>WhatsApp Inquiry</span>
                  </a>
                </div>
              </div>

              {/* Map card — read-only for visitors, editable in the owner editor. */}
              <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white p-2 min-h-[380px] shadow-xs">
                {!isEditMode ? (
                  <WebsiteLocationMap profile={activeProfile} />
                ) : (
                  <InteractiveMapSetup 
                    profile={activeProfile}
                    setProfile={setProfile || (() => {})}
                  />
                )}
              </div>
            </div>
          </section>
        )}

        {/* 8. FOOTER WITH DYNAMIC SOCIAL LINKS */}
        <footer className={`py-8 px-6 md:px-12 border-t text-center ${
          isDarkCanvas ? 'bg-[#0b0b0e] border-neutral-900 text-neutral-400' : 'bg-slate-50 border-slate-200 text-slate-500'
        }`}>
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-left">
              <span className={`font-extrabold text-sm tracking-tight ${isDarkCanvas ? 'text-white' : 'text-slate-900'}`}>
                {activeProfile.businessName}
              </span>
              <p className={`text-[10px] mt-1 ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-400'}`}>
                © {new Date().getFullYear()} {activeProfile.businessName}. All rights reserved.
              </p>
            </div>

            {/* Social Links Bar */}
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {/* ... social links remain the same ... */}
              {activeProfile.instagramHandle && (
                <a
                  href={formatInstagramUrl(siteConfig.social_links.instagram)}
                  target="_blank"
                  rel="noreferrer"
                  className="w-8 h-8 rounded-full border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
                  title="Instagram Profile"
                >
                  <Instagram className="w-4 h-4 text-pink-600" />
                </a>
              )}

              {activeProfile.facebookPage && (
                <a
                  href={formatFacebookUrl(siteConfig.social_links.facebook)}
                  target="_blank"
                  rel="noreferrer"
                  className="w-8 h-8 rounded-full border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
                  title="Facebook Page"
                >
                  <Facebook className="w-4 h-4 text-blue-600" />
                </a>
              )}

              {activeProfile.youtubeChannel && (
                <a
                  href={activeProfile.youtubeChannel}
                  target="_blank"
                  rel="noreferrer"
                  className="w-8 h-8 rounded-full border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
                  title="YouTube Channel"
                >
                  <Youtube className="w-4 h-4 text-red-600" />
                </a>
              )}

              {getTikTokValue(activeProfile) && <a href={formatTikTokUrl(siteConfig.social_links.tiktok)} target="_blank" rel="noreferrer" className="text-xs font-bold underline">TikTok</a>}
              {activeProfile.whatsapp && (
                <a
                  href={`https://wa.me/${activeProfile.whatsapp.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-8 h-8 rounded-full border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
                  title="WhatsApp Chat"
                >
                  <MessageSquare className="w-4 h-4 text-emerald-600" />
                </a>
              )}

              {activeProfile.googleBusinessUrl && (
                <a
                  href={activeProfile.googleBusinessUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-8 h-8 rounded-full border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
                  title="Google Business Listing"
                >
                  <svg className="w-3.5 h-3.5 text-blue-500 fill-current" viewBox="0 0 24 24">
                    <path d="M12.24 10.285V13.4h6.887C18.2 15.614 15.645 18 12.24 18c-3.86 0-7-3.14-7-7s3.14-7 7-7c1.7 0 3.25.61 4.46 1.614l2.427-2.427C17.485 1.77 15.02 1 12.24 1 6.58 1 2 5.58 2 11.24s4.58 10.24 10.24 10.24c5.9 0 9.8-4.14 9.8-9.98 0-.6-.05-1.18-.15-1.72H12.24z" />
                  </svg>
                </a>
              )}
            </div>
          </div>
          
          {!activeProfile.whiteLabelEnabled && (
            <div className={`mt-6 text-[10px] font-medium opacity-50 ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-500'}`}>
              Powered by Nexora Salon Platform
            </div>
          )}
        </footer>

      </div>

      {/* Floating Instant WhatsApp Button */}
      {sectionVisibility.whatsappFloat && activeProfile.whatsapp?.replace(/\D/g, '') && (
        <a
          href={`https://wa.me/${activeProfile.whatsapp.replace(/\D/g, '')}?text=Hi%20${encodeURIComponent(activeProfile.businessName)},%20I%20would%20like%20to%20book%20an%20appointment.`}
          target="_blank"
          rel="noreferrer"
          className="layout-stable-fixed fixed bottom-6 right-6 z-40 bg-emerald-500 hover:bg-emerald-600 text-white p-3.5 rounded-full shadow-2xl flex items-center gap-2 transition-all hover:scale-105 active:scale-95 group cursor-pointer"
          title="Chat on WhatsApp"
        >
          <MessageSquare className="w-5 h-5 fill-white" />
          <span className="text-xs font-bold max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 whitespace-nowrap">
            WhatsApp Booking
          </span>
        </a>
      )}

      {publicView && !previewMode && (
        <nav
          aria-label="Salon quick actions"
          className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-slate-200/80 bg-white/95 px-1 pt-1 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur-xl md:hidden [padding-bottom:calc(env(safe-area-inset-bottom)+0.25rem)]"
        >
          {[
            { id: 'home' as const, label: 'Home', icon: Home, onClick: () => scrollToMobileSection('home') },
            { id: 'services' as const, label: 'Services', icon: List, onClick: () => scrollToMobileSection('services') },
            { id: 'book' as const, label: 'Book Now', icon: CalendarCheck, onClick: () => handleOpenBooking() },
            { id: 'location' as const, label: 'Location', icon: MapPin, onClick: () => scrollToMobileSection('location') },
          ].map((item) => {
            const active = item.id === mobileNavActive || item.id === 'book';
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" onClick={item.onClick} className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-bold transition-all active:scale-95 ${active ? 'text-[var(--primary-accent)]' : 'text-slate-500'}`}>
                {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-[var(--primary-accent)] shadow-[0_0_10px_var(--primary-accent)]" />}
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
          {activeProfile.whatsapp ? (
            <a href={`https://wa.me/${activeProfile.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-bold text-emerald-600 active:scale-95">
              <MessageSquare className="h-5 w-5" />
              <span>WhatsApp</span>
            </a>
          ) : (
            <a href={`tel:${activeProfile.phone?.replace(/\D/g, '') || ''}`} className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-bold text-slate-700 active:scale-95">
              <PhoneCall className="h-5 w-5" />
              <span>Call</span>
            </a>
          )}
        </nav>
      )}

      {/* Booking Modal Flow */}
      {activeServices.length > 0 && activeProfile.acceptsOnlineBookings !== false && <BookingModal
        isOpen={isBookingOpen}
        onClose={() => {
          setIsBookingOpen(false);
          setBookingFromHistory(false);
        }}
        fromHistory={bookingFromHistory}
        profile={activeProfile}
        services={activeServices}
        stylists={activeStylists}
        initialService={selectedService}
        initialStylist={selectedStylist}
        onAddAppointment={(newApt) => {
          onAddAppointment(newApt);
          setIsBookingOpen(false);
        }}
        themeAccentHex={activeAccent.primaryHex}
        user={user}
        onRequireAuth={onRequireAuth}
        onShowToast={(toastData) => {
          setToastMessage({
            id: toastData.id,
            title: toastData.title,
            clientName: toastData.clientName,
            serviceName: toastData.serviceName,
            stylistName: toastData.stylistName,
            dateTime: toastData.dateTime,
            refCode: toastData.refCode,
            price: toastData.price
          });
        }}
        loyalty={publicSalon.loyalty}
      />}

      {/* Gallery Lightbox Modal */}
      {selectedGalleryPhoto && (() => {
        const galleryPhotos = activeGalleryPhotos;
        const currentIndex = galleryPhotos.findIndex(photo => photo.url === selectedGalleryPhoto);
        const currentPhoto = galleryPhotos[currentIndex];

        const handlePrevPhoto = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (galleryPhotos.length > 0 && currentIndex !== -1) {
            const prevIndex = (currentIndex - 1 + galleryPhotos.length) % galleryPhotos.length;
            setSelectedGalleryPhoto(galleryPhotos[prevIndex].url);
          }
        };

        const handleNextPhoto = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (galleryPhotos.length > 0 && currentIndex !== -1) {
            const nextIndex = (currentIndex + 1) % galleryPhotos.length;
            setSelectedGalleryPhoto(galleryPhotos[nextIndex].url);
          }
        };

        return (
          <div 
            className="layout-stable-fixed fixed inset-0 z-50 min-h-dvh bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-4 md:p-8"
            onClick={() => setSelectedGalleryPhoto(null)}
          >
            {/* Top Toolbar */}
            <div className="w-full max-w-5xl flex items-center justify-between text-white pb-4 border-b border-white/10 shrink-0">
              <div className="text-left">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                  {currentPhoto?.tag || 'Gallery Photo'}
                </span>
                <h3 className="text-sm md:text-base font-extrabold tracking-tight">
                  {currentPhoto?.title || 'Studio Lookbook View'}
                </h3>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-neutral-400">
                  {currentIndex + 1} / {galleryPhotos.length}
                </span>
                <button
                  onClick={() => setSelectedGalleryPhoto(null)}
                  className="bg-white/10 text-white p-2.5 rounded-full hover:bg-white/20 transition-all cursor-pointer"
                  title="Close Lightbox"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Main Image Stage with Navigation Controls */}
            <div className="relative w-full max-w-5xl flex-1 flex items-center justify-center py-6 min-h-0">
              {/* Prev Button */}
              {galleryPhotos.length > 1 && (
                <button
                  onClick={handlePrevPhoto}
                  className="absolute left-2 md:left-4 z-10 bg-black/60 hover:bg-black text-white p-3 md:p-4 rounded-full border border-white/10 transition-all cursor-pointer shadow-lg hover:scale-105 active:scale-95 shrink-0 flex items-center justify-center"
                  title="Previous Photo"
                >
                  <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" />
                </button>
              )}

              {/* Central Image Container */}
              <div 
                className="relative max-h-full max-w-[85vw] md:max-w-[70vw] rounded-2xl overflow-hidden shadow-2xl bg-black border border-white/5 flex items-center justify-center aspect-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <img 
                  src={selectedGalleryPhoto} 
                  alt={currentPhoto?.title || 'Gallery Zoom'} 
                  className="max-h-[60dvh] md:max-h-[68dvh] object-contain w-full rounded-2xl"
                />
              </div>

              {/* Next Button */}
              {galleryPhotos.length > 1 && (
                <button
                  onClick={handleNextPhoto}
                  className="absolute right-2 md:right-4 z-10 bg-black/60 hover:bg-black text-white p-3 md:p-4 rounded-full border border-white/10 transition-all cursor-pointer shadow-lg hover:scale-105 active:scale-95 shrink-0 flex items-center justify-center"
                  title="Next Photo"
                >
                  <ChevronRight className="w-5 h-5 md:w-6 md:h-6" />
                </button>
              )}
            </div>

            {/* Interactive Thumbnail Carousel */}
            {galleryPhotos.length > 1 && (
              <div 
                className="w-full max-w-2xl py-4 border-t border-white/10 shrink-0 flex items-center justify-center gap-2 overflow-x-auto no-scrollbar"
                onClick={(e) => e.stopPropagation()}
              >
                {galleryPhotos.map((photo, idx) => {
                  const isActive = idx === currentIndex;
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedGalleryPhoto(photo.url)}
                      className={`relative w-12 h-12 md:w-16 md:h-16 rounded-xl overflow-hidden cursor-pointer border-2 transition-all flex-shrink-0 ${
                        isActive 
                          ? 'border-emerald-400 scale-110 shadow-lg' 
                          : 'border-transparent opacity-50 hover:opacity-100'
                      }`}
                    >
                      <img 
                        src={photo.url} 
                        alt="thumbnail" 
                        className="w-full h-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Booking Confirmation Toast */}
      {toastMessage && (
        <div className="layout-stable-fixed fixed bottom-6 left-6 z-50 max-w-sm w-full bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-700 flex flex-col gap-2.5 animate-in slide-in-from-bottom">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
              <CheckCircle2 className="w-4 h-4" />
              <span>{toastMessage.title}</span>
            </div>
            <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white p-1">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="text-xs text-slate-300">
            <div><strong>Client:</strong> {toastMessage.clientName}</div>
            <div><strong>Service:</strong> {toastMessage.serviceName} (₹{toastMessage.price})</div>
            <div><strong>Specialist:</strong> {toastMessage.stylistName}</div>
            <div><strong>Slot:</strong> {toastMessage.dateTime}</div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px] font-mono">
            <span>Ref: {toastMessage.refCode}</span>
            <button
              onClick={() => handleCopyRefCode(toastMessage.refCode)}
              className="text-emerald-400 hover:underline flex items-center gap-1"
            >
              {copiedRef ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copiedRef ? 'Copied' : 'Copy Ref'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Testimonials Modal Editor */}
      <TestimonialModal
        isOpen={isTestimonialModalOpen}
        onClose={() => setIsTestimonialModalOpen(false)}
        onSave={handleSaveTestimonial}
        editingTestimonial={editingTestimonial}
        defaultCity={activeProfile.city}
        availableServices={activeServices.map((s) => s.name)}
      />

      {/* Dynamic Promotional Popup Overlay */}
      {showPromoPopup && (() => {
        const featuredOffer = visibleOffers[0];
        if (!featuredOffer) return null;

        let daysLeftText = '';
        if (featuredOffer.expiryDate) {
          const end = new Date(featuredOffer.expiryDate + 'T23:59:59');
          const diff = end.getTime() - new Date().getTime();
          const days = Math.floor(diff / (1000 * 60 * 60 * 24));
          if (diff <= 0) {
            daysLeftText = 'Expired';
          } else {
            daysLeftText = days > 0 ? `${days}d left` : 'Ends Today';
          }
        }

        return (
          <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
            <div 
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-w-md w-full relative animate-scale-up"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Promo Banner Cover */}
              <div className="w-full h-44 relative bg-slate-100">
                <img 
                  src={featuredOffer.imageUrl || 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=600&q=80'} 
                  alt={featuredOffer.title} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                
                {/* Top Corner Close Button */}
                <button
                  type="button"
                  onClick={() => setShowPromoPopup(false)}
                  className="absolute top-3 right-3 bg-black/45 hover:bg-black/70 text-white p-1.5 rounded-full transition-all cursor-pointer shadow border border-white/10"
                  title="Close popup"
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="absolute bottom-3 left-4 right-4">
                  <span className="bg-red-500 text-white font-black px-2 py-0.5 rounded text-[10px] tracking-wider shadow-xs uppercase">
                    {featuredOffer.discountValue || 'PROMO'}
                  </span>
                  <h3 className="text-white text-base font-black mt-1 leading-snug drop-shadow-sm">
                    {featuredOffer.title}
                  </h3>
                </div>
              </div>

              {/* Promo Description */}
              <div className="p-4 flex flex-col gap-3.5">
                <p className="text-xs text-slate-500 leading-relaxed">
                  {featuredOffer.description || 'Pamper yourself today with our exclusive, premium salon services discount! Grab the code below.'}
                </p>

                {/* Validity Period & Live Countdown Timer */}
                <div className="flex flex-wrap items-center gap-1.5 py-2 border-y border-slate-100 text-[10px] font-mono font-bold">
                  <div className="flex items-center gap-1 bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded border border-amber-100/50">
                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                    <span>{daysLeftText || 'Ongoing Offer'}</span>
                  </div>
                  
                  <div className="flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded border border-indigo-100/50">
                    <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Validity: {featuredOffer.startDate || 'Now'} to {featuredOffer.expiryDate || 'Always'}</span>
                  </div>
                </div>

                {/* Coupon Copy Block */}
                <div className="p-2.5 bg-slate-50 border border-dashed border-slate-200 rounded-xl flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[9px] text-slate-400 font-mono uppercase tracking-widest">COUPON CODE</div>
                    <div className="font-mono font-black text-sm text-emerald-600 tracking-wider">
                      {featuredOffer.code}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                    onClick={async () => {
                      const ok = await copyToClipboard(featuredOffer.code);
                      if (ok) {
                        setNotificationToast(`Code "${featuredOffer.code}" copied to clipboard! ✨`);
                        setTimeout(() => setNotificationToast(null), 2500);
                      }
                    }}
                  >
                    Copy Code
                  </button>
                </div>

                {/* Footers */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowPromoPopup(false)}
                    className="flex-1 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs rounded-xl cursor-pointer transition-colors text-center"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPromoPopup(false);
                      const target = document.getElementById('services-section') || document.getElementById('offers-section');
                      if (target) {
                        target.scrollIntoView({ behavior: 'smooth' });
                      }
                    }}
                    className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors text-center shadow-sm"
                  >
                    Claim & Book Now
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
};
