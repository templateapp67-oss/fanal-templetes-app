import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  Star, 
  ShieldCheck, 
  Award, 
  Navigation, 
  ExternalLink, 
  ChevronRight, 
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
import { SalonProfile, SalonService, Stylist, Appointment, BusinessTypeId } from '../types';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';
import { ACCENT_PALETTES, DEFAULT_CATEGORY_ACCENTS, AccentPaletteKey, applyPrimaryAccentCssVar, getContrastTextColor, getLuminance } from '../themeAccents';
import { CATEGORY_STANDARDIZED_DATA, Testimonial } from '../templateData';
import { INITIAL_SALON_PROFILE } from '../mockData';
import { BookingModal } from './BookingModal';
import { InlineEditable } from './InlineEditable';
import { SidePanelCustomizer, SectionVisibilityState, DEFAULT_SECTION_VISIBILITY } from './SidePanelCustomizer';
import { computeHeroAIStyling, extractImageMoodAsync, HeroAIStyling } from '../utils/heroImageMood';
import { TestimonialModal } from './ClientTestimonials';

interface SalonWebsitePreviewProps {
  profile: SalonProfile;
  setProfile?: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services: SalonService[];
  setServices?: React.Dispatch<React.SetStateAction<SalonService[]>>;
  stylists: Stylist[];
  setStylists?: React.Dispatch<React.SetStateAction<Stylist[]>>;
  onAddAppointment: (appointment: Appointment) => void;
  onSelectCategory?: (categoryId: BusinessTypeId) => void;
}

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
}) => {
  // Fallback internal state if setters not passed
  const [internalProfile, setInternalProfile] = useState<SalonProfile>(profile);
  const [internalServices, setInternalServices] = useState<SalonService[]>(services);
  const [internalStylists, setInternalStylists] = useState<Stylist[]>(stylists);

  const activeProfile = (setProfileProp ? profile : internalProfile) || INITIAL_SALON_PROFILE;
  const setProfile = setProfileProp || setInternalProfile;

  const activeServices = setServicesProp ? services : internalServices;
  const setServices = setServicesProp || setInternalServices;

  const activeStylists = setStylistsProp ? stylists : internalStylists;
  const setStylists = setStylistsProp || setInternalStylists;

  // Viewport & Editor Controls
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [isCustomizerOpen, setIsCustomizerOpen] = useState<boolean>(false);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<BusinessTypeId>(activeProfile.businessType || 'hair_salon');

  // Synchronize category selection if parent changes businessType
  useEffect(() => {
    if (activeProfile.businessType && activeProfile.businessType !== selectedCategoryKey) {
      setSelectedCategoryKey(activeProfile.businessType);
    }
  }, [activeProfile.businessType]);

  // Synchronize client reviews when category selection changes
  useEffect(() => {
    const data = CATEGORY_STANDARDIZED_DATA[selectedCategoryKey] || CATEGORY_STANDARDIZED_DATA.hair_salon;
    setActiveReviews(data.reviews || []);
  }, [selectedCategoryKey]);

  // Side Panel Section Visibility
  const [sectionVisibility, setSectionVisibility] = useState<SectionVisibilityState>(DEFAULT_SECTION_VISIBILITY);

  // Active template configuration
  const activeTemplate = CATEGORY_TEMPLATES[selectedCategoryKey] || CATEGORY_TEMPLATES.hair_salon;

  // Active Accent Palette selection
  const [selectedAccentKey, setSelectedAccentKey] = useState<AccentPaletteKey>(
    (activeProfile.themeAccentKey as AccentPaletteKey) || DEFAULT_CATEGORY_ACCENTS[selectedCategoryKey] || 'slate'
  );
  const [isDarkCanvas, setIsDarkCanvas] = useState<boolean>(
    activeTemplate.themeStyle.isDark || selectedAccentKey === 'obsidian'
  );

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

  const activeAccent = ACCENT_PALETTES[selectedAccentKey] || ACCENT_PALETTES.slate;
  const primaryAccentColor = activeProfile.customAccentColor || activeAccent.primaryHex;

  // Update primary accent CSS variable across the document
  useEffect(() => {
    applyPrimaryAccentCssVar(primaryAccentColor, activeAccent.secondaryHex);
  }, [primaryAccentColor, activeAccent]);

  // Dynamic Image-Based AI Styling State
  const [heroAIStyling, setHeroAIStyling] = useState<HeroAIStyling>(() =>
    computeHeroAIStyling(activeProfile.coverImageUrl, primaryAccentColor)
  );

  useEffect(() => {
    let isMounted = true;

    extractImageMoodAsync(activeProfile.coverImageUrl, primaryAccentColor).then((extracted) => {
      if (isMounted) {
        setHeroAIStyling(extracted);
      }
    });

    return () => { isMounted = false; };
  }, [activeProfile.coverImageUrl, primaryAccentColor]);

  const standardData = CATEGORY_STANDARDIZED_DATA[selectedCategoryKey] || CATEGORY_STANDARDIZED_DATA.hair_salon;

  // Interactive filters & booking modals
  const [activeSubCategory, setActiveSubCategory] = useState<string>('All');
  const [isBookingOpen, setIsBookingOpen] = useState<boolean>(false);
  const [selectedService, setSelectedService] = useState<SalonService>(activeServices[0] || activeTemplate.services[0]);
  const [selectedStylist, setSelectedStylist] = useState<Stylist>(activeStylists[0] || activeTemplate.stylists[0]);
  const [selectedGalleryPhoto, setSelectedGalleryPhoto] = useState<string | null>(null);

  // Dynamic client testimonials state
  const [activeReviews, setActiveReviews] = useState<Testimonial[]>(() => {
    const data = CATEGORY_STANDARDIZED_DATA[selectedCategoryKey] || CATEGORY_STANDARDIZED_DATA.hair_salon;
    return data.reviews || [];
  });
  const [isTestimonialModalOpen, setIsTestimonialModalOpen] = useState<boolean>(false);
  const [editingTestimonial, setEditingTestimonial] = useState<Testimonial | null>(null);

  // Editable section custom headings
  const [sectionHeadings, setSectionHeadings] = useState<{
    servicesTitle: string;
    servicesSubtitle: string;
    stylistsTitle: string;
    stylistsSubtitle: string;
    testimonialsTitle: string;
    galleryTitle: string;
    locationTitle: string;
  }>({
    servicesTitle: 'Curated Services & Treatments',
    servicesSubtitle: 'Explore our handcrafted menu with transparent pricing in INR (₹).',
    stylistsTitle: 'Meet Our Master Specialists & Stylists',
    stylistsSubtitle: 'Dedicated artisans trained in contemporary international and classical Indian beauty traditions.',
    testimonialsTitle: 'Loved by 1,200+ Verified Clients',
    galleryTitle: 'Studio Lookbook & Client Transformations',
    locationTitle: 'Visit Our Sanctuary'
  });

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

  const handleCopyRefCode = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const subCategoriesList = ['All', ...(activeTemplate.subCategories || ['Hair', 'Spa', 'Care'])];

  const filteredServices = activeSubCategory === 'All'
    ? activeServices
    : activeServices.filter((s) => s.category === activeSubCategory);

  // Category template switcher
  const handleCategorySwitch = (catId: BusinessTypeId) => {
    setSelectedCategoryKey(catId);
    const tmpl = CATEGORY_TEMPLATES[catId];
    if (tmpl) {
      setIsEditMode(false);
      setActiveSubCategory('All');
      setSelectedService(tmpl.services[0]);
      setSelectedStylist(tmpl.stylists[0]);
      
      const newAccent = DEFAULT_CATEGORY_ACCENTS[catId] || 'slate';
      setSelectedAccentKey(newAccent);
      setIsDarkCanvas(tmpl.themeStyle.isDark || newAccent === 'obsidian');

      setProfile((prev) => ({
        ...prev,
        businessType: tmpl.id,
        businessName: tmpl.title,
        ownerName: tmpl.ownerName,
        ownerRole: tmpl.ownerRole,
        phone: tmpl.phone,
        whatsapp: tmpl.whatsapp,
        tagline: tmpl.tagline,
        about: tmpl.about,
        ownerPhotoUrl: tmpl.ownerPhotoUrl,
        coverImageUrl: tmpl.coverImageUrl,
        themePreset: tmpl.themePreset,
        currency: '₹',
        subdomain: tmpl.id.replace('_', ''),
        address: tmpl.defaultAddress,
        city: tmpl.defaultCity,
        postalCode: tmpl.defaultPostalCode,
        instagramHandle: tmpl.instagramHandle,
        themeAccentKey: newAccent,
        customAccentColor: undefined
      }));

      setServices(tmpl.services);
      setStylists(tmpl.stylists);

      if (onSelectCategory) {
        onSelectCategory(catId);
      }

      showNotification(`Switched to "${tmpl.title}" template with Indian INR (₹) rates!`);
    }
  };

  const handleOpenBooking = (srv?: SalonService) => {
    if (srv) {
      setSelectedService(srv);
    } else {
      setSelectedService(activeServices[0] || activeTemplate.services[0]);
    }
    setSelectedStylist(activeStylists[0] || activeTemplate.stylists[0]);
    setIsBookingOpen(true);
  };

  // Inline Service Actions
  const handleUpdateServicePrice = (serviceId: string, newPrice: number) => {
    setServices((prev) =>
      prev.map((s) => (s.id === serviceId ? { ...s, price: Number(newPrice) || s.price } : s))
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
    desktop: 'w-full max-w-[1240px]',
    tablet: 'w-full max-w-[768px]',
    mobile: 'w-full max-w-[390px]'
  }[deviceMode];

  const themeStyle = activeTemplate.themeStyle;
  const contrastTextColor = getContrastTextColor(primaryAccentColor);
  const accentLuminance = getLuminance(primaryAccentColor);

  return (
    <div 
      className="min-h-screen pt-20 pb-24 flex flex-col items-center bg-slate-100 text-slate-900 font-sans relative select-text"
      style={{
        '--primary-accent': primaryAccentColor,
        '--theme-primary': primaryAccentColor,
        '--theme-secondary': activeAccent.secondaryHex,
        '--color-primary': primaryAccentColor,
        '--accent-luminance': accentLuminance.toFixed(4),
        '--accent-text-color': contrastTextColor,
        '--accent-contrast-text': contrastTextColor,
        '--color-on-primary': contrastTextColor,
        '--theme-on-accent': contrastTextColor,
        '--heading-text-shadow': '0 1px 3px rgba(0, 0, 0, 0.45)',
      } as React.CSSProperties}
    >
      
      {/* Toast Notifications */}
      <AnimatePresence>
        {notificationToast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-24 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs border border-slate-700 font-medium"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{notificationToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================ */}
      {/* 1. TOP UNIFIED NAVIGATION & AI STUDIO CONTROLS BAR */}
      {/* ============================================================ */}
      <div className="w-full bg-white border-b border-slate-200 sticky top-20 z-40 shadow-xs">
        <div className="max-w-[1440px] mx-auto px-4 py-2.5 flex flex-col gap-2.5">
          
          {/* Main Controls Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            
            {/* Left Status & Subdomain */}
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-700">
                <span className="font-bold">{activeProfile.subdomain}.nexora.in</span>
                <span className="text-slate-400">•</span>
                <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[11px] font-bold border border-emerald-200">
                  INR (₹) Live
                </span>
              </div>
            </div>

            {/* Mode Switcher: Inline Edit Mode vs Preview Mode */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
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
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
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
            <div className="flex items-center gap-2">
              {/* Customizer Side-Panel Toggle Button */}
              <button
                type="button"
                onClick={() => setIsCustomizerOpen(!isCustomizerOpen)}
                className={`text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 border shadow-xs transition-all cursor-pointer ${
                  isCustomizerOpen
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                }`}
                id="toggle-customizer-top-btn"
              >
                <Sliders className="w-4 h-4 text-amber-500" />
                <span>Side Customizer</span>
              </button>

              {/* Fast Test Booking Modal Button */}
              <button
                type="button"
                onClick={() => handleOpenBooking()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
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
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-thin text-xs shrink-0">
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
          <div className="pt-2 border-t border-slate-100 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">category</span>
              14 Category Templates:
            </span>
            {Object.values(CATEGORY_TEMPLATES).map((tmpl) => {
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

      {/* Side-Panel Customizer Drawer */}
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

      {/* Edit Mode Notice Banner */}
      {isEditMode && (
        <div className="w-full max-w-[1240px] px-4 mt-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3 text-xs text-amber-900 shadow-xs">
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
        className={`mt-4 transition-all duration-300 ${deviceWidthClass} shadow-2xl rounded-2xl overflow-hidden border border-slate-200 my-4 ${
          isDarkCanvas ? 'bg-[#0f0f13] text-neutral-100' : 'bg-white text-slate-900'
        }`}
        id="salon-website-canvas"
      >
        
        {/* Template Header Notice */}
        <div className={`py-2 px-6 text-xs flex flex-wrap items-center justify-between gap-2 ${
          isDarkCanvas ? 'bg-[#181820] border-b border-neutral-800 text-neutral-300' : 'bg-slate-50 border-b border-slate-200 text-slate-700'
        }`}>
          <div className="flex items-center gap-2 font-medium">
            <span className="material-symbols-outlined text-base">{activeTemplate.icon}</span>
            <span><strong>Template:</strong> {activeTemplate.title}</span>
            <span className="text-slate-400">•</span>
            <span className="font-mono text-[11px] font-bold" style={{ color: activeAccent.primaryHex }}>
              Accent: {activeAccent.name}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <MapPin className="w-3 h-3 text-slate-400" />
            <InlineEditable
              value={activeProfile.city}
              onSave={(val) => setProfile((p) => ({ ...p, city: String(val) }))}
              isEditingActive={isEditMode}
              label="Salon City"
            />
          </div>
        </div>

        {/* ============================================================ */}
        {/* SECTION: SALON SITE NAV HEADER & STICKY BOOKING TRIGGER */}
        {/* ============================================================ */}
        {sectionVisibility.header && (
          <header className={`px-6 md:px-10 py-4 flex justify-between items-center border-b transition-colors ${
            isDarkCanvas ? 'bg-[#121216]/95 backdrop-blur-md border-neutral-800 text-white' : 'bg-white/95 backdrop-blur-md border-slate-100 text-slate-900'
          }`}>
            <div className="flex items-center gap-3">
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
                <div className="font-bold text-lg md:text-xl tracking-tight leading-snug">
                  <InlineEditable
                    value={activeProfile.businessName}
                    onSave={(val) => setProfile((p) => ({ ...p, businessName: String(val) }))}
                    isEditingActive={isEditMode}
                    label="Salon Name"
                  />
                </div>
                <div className={`text-[11px] flex items-center gap-1 font-mono ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-500'}`}>
                  <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate max-w-[280px] sm:max-w-md">
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
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden lg:flex flex-col text-right">
                <span className="text-[11px] font-mono text-slate-400">Direct Appointments</span>
                <span className="text-xs font-bold font-mono">
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
          <section className="relative overflow-hidden transition-all bg-slate-950 text-white min-h-[480px] md:min-h-[540px] flex items-center">
            {/* Background Image & Gentle Ambient Mask (15-25% Overlay Max) */}
            <div className="absolute inset-0 z-0 overflow-hidden">
              <img
                src={activeProfile.coverImageUrl}
                alt={activeProfile.businessName}
                className={`w-full h-full object-cover object-center ${heroAIStyling.imageFilterClass} transition-all duration-700 hover:scale-105`}
              />
              {/* Dynamic Overlay Ambient Tint (Gentle ~15-25% mask max) */}
              <div 
                className={`absolute inset-0 ${heroAIStyling.overlayGradientClass} pointer-events-none transition-all duration-500`}
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
                <div className="flex flex-wrap items-center gap-2 mb-4">
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
                  className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight text-balance transition-colors duration-300"
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
                    <div>
                      <div className={`${heroAIStyling.metricsLabelColor} font-mono text-[10px] uppercase`}>Services from</div>
                      <div className={`text-xl font-bold font-mono ${heroAIStyling.metricsValueColor}`}>
                        ₹{Math.min(...activeServices.map((s) => s.price))}
                      </div>
                    </div>
                    <div>
                      <div className={`${heroAIStyling.metricsLabelColor} font-mono text-[10px] uppercase`}>Lead Specialist</div>
                      <div className="text-sm font-bold truncate">
                        <InlineEditable
                          value={activeProfile.ownerName}
                          onSave={(val) => setProfile((p) => ({ ...p, ownerName: String(val) }))}
                          isEditingActive={isEditMode}
                          label="Lead Specialist Name"
                        />
                      </div>
                    </div>
                    <div>
                      <div className={`${heroAIStyling.metricsLabelColor} font-mono text-[10px] uppercase`}>Specialty</div>
                      <div className="text-sm font-bold truncate">{activeTemplate.subCategories[0] || 'Artistry'}</div>
                    </div>
                    <div>
                      <div className={`${heroAIStyling.metricsLabelColor} font-mono text-[10px] uppercase`}>Client Rating</div>
                      <div className="text-sm font-bold flex items-center gap-1 text-amber-400">
                        <Star className="w-3.5 h-3.5 fill-amber-400" />
                        <span>{standardData.averageRating} ({standardData.totalReviewCount}+ Reviews)</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Primary Action Buttons */}
                <div className="flex flex-wrap items-center gap-3.5 mt-8">
                  <button
                    type="button"
                    onClick={() => handleOpenBooking()}
                    className="font-bold text-sm px-6 py-3.5 rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
                    style={{ 
                      backgroundColor: heroAIStyling.primaryBtnBg,
                      color: heroAIStyling.primaryBtnText 
                    }}
                  >
                    <span>Book Now in INR (₹)</span>
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
        <div className={`px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs border-b ${
          isDarkCanvas ? 'bg-[#15151c] border-neutral-800 text-neutral-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0">
              <MapPin className="w-3.5 h-3.5" />
            </span>
            <span>
              <strong>Salon Location:</strong> {activeProfile.address}, {activeProfile.city} - <span className="font-mono">{activeProfile.postalCode}</span>
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>Open Today {standardData.openHourText} – {standardData.closeHourText}</span>
            </span>
            <span className="hidden sm:inline text-slate-400">•</span>
            <span className="hidden sm:inline text-slate-500">Walk-ins & Advance Bookings</span>
          </div>
        </div>

        {/* ============================================================ */}
        {/* 2. ABOUT SALON SECTION (STORY, HYGIENE CERTIFICATIONS) */}
        {/* ============================================================ */}
        {sectionVisibility.about && (
          <section className={`p-6 md:p-12 border-b ${
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
                  {standardData.foundingNarrative}
                </p>
              </div>

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
                      src={activeProfile.ownerPhotoUrl}
                      alt={activeProfile.ownerName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="absolute -bottom-2 -right-2 bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-xs">
                    Lead
                  </span>
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <p className={`text-xs italic leading-relaxed ${isDarkCanvas ? 'text-neutral-300' : 'text-slate-700'}`}>
                    "Every client deserves an uncompromising standard of individual personalization, certified non-toxic products, and medical-grade sterilization in an atmosphere of warmth and calmness."
                  </p>
                  <div className="mt-2">
                    <span className="font-bold text-sm block">
                      <InlineEditable
                        value={activeProfile.ownerName}
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
          </section>
        )}

        {/* ============================================================ */}
        {/* 3. SERVICES & PRICING MENU SECTION (100% INLINE EDITABLE) */}
        {/* ============================================================ */}
        {sectionVisibility.services && (
          <section className={`p-6 md:p-12 border-b ${
            isDarkCanvas ? 'bg-[#0f0f13] border-neutral-800' : 'bg-white border-slate-200'
          }`} id="services-section">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
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

              {/* Sub-Category Filter Tabs & Add Service button */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
                  {subCategoriesList.map((subCat) => {
                    const isActive = activeSubCategory === subCat;
                    return (
                      <button
                        key={subCat}
                        type="button"
                        onClick={() => setActiveSubCategory(subCat)}
                        className={`text-xs font-extrabold px-3.5 py-2 rounded-xl whitespace-nowrap transition-all cursor-pointer ${
                          isActive
                            ? 'shadow-xs'
                            : isDarkCanvas
                            ? 'bg-neutral-900 text-neutral-300 hover:text-white border border-neutral-800'
                            : 'bg-slate-100 text-slate-700 hover:text-slate-900 hover:bg-slate-200 border border-slate-200/60'
                        }`}
                        style={isActive ? { backgroundColor: activeAccent.primaryHex, color: 'var(--accent-text-color, #ffffff)' } : {}}
                      >
                        {subCat}
                      </button>
                    );
                  })}
                </div>

                {isEditMode && (
                  <button
                    type="button"
                    onClick={handleAddNewService}
                    className="text-xs font-bold px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs cursor-pointer"
                    title="Add new custom service to menu"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Service</span>
                  </button>
                )}
              </div>
            </div>

            {/* Services Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredServices.map((srv) => (
                <div
                  key={srv.id}
                  className={`p-5 rounded-2xl border transition-all flex flex-col justify-between gap-4 group ${
                    isDarkCanvas
                      ? 'bg-neutral-900/80 border-neutral-800 hover:border-neutral-700'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-extrabold text-base md:text-lg leading-snug ${
                          isDarkCanvas ? 'text-white' : 'text-slate-900'
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
                            className="text-[10px] font-mono font-extrabold px-2.5 py-0.5 rounded-lg border border-white/20 shadow-2xs shrink-0 tracking-wider uppercase"
                            style={{ backgroundColor: activeAccent.primaryHex, color: 'var(--accent-text-color, #ffffff)' }}
                          >
                            POPULAR
                          </span>
                        )}
                      </div>

                      <p className={`text-xs mt-1.5 leading-relaxed font-medium ${
                        isDarkCanvas ? 'text-neutral-300' : 'text-slate-600'
                      }`}>
                        <InlineEditable
                          value={srv.description}
                          onSave={(val) => handleUpdateServiceDesc(srv.id, String(val))}
                          isEditingActive={isEditMode}
                          type="textarea"
                          label="Service Description"
                        />
                      </p>
                    </div>

                    {/* Price & Duration with Inline Editable INR (₹) */}
                    <div className="text-right shrink-0 flex flex-col items-end">
                      <div className={`text-lg md:text-xl font-extrabold font-mono ${
                        isDarkCanvas ? 'text-emerald-400' : 'text-emerald-700'
                      }`}>
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
                      {/* Duration Display */}
                      {(srv.showDuration !== false || isEditMode) && (
                        <div className={`text-[11px] font-mono flex items-center gap-1 mt-1 px-2 py-0.5 rounded-md border ${
                          srv.showDuration === false 
                            ? 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800' 
                            : isDarkCanvas
                            ? 'text-neutral-300 bg-neutral-800 border-neutral-700'
                            : 'text-slate-700 bg-slate-100 border-slate-200'
                        }`}>
                          <Clock className="w-3 h-3 text-slate-500 dark:text-neutral-400 shrink-0" />
                          <InlineEditable
                            value={srv.durationMinutes}
                            onSave={(val) => handleUpdateServiceDuration(srv.id, Number(val))}
                            isEditingActive={isEditMode}
                            type="number"
                            suffix=" mins"
                            label="Duration"
                          />
                          {isEditMode && srv.showDuration === false && (
                            <span className="text-[9px] font-mono font-bold text-amber-700 dark:text-amber-300 ml-1">
                              (Hidden)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar inside Card */}
                  <div className={`flex items-center justify-between pt-3 border-t text-xs ${
                    isDarkCanvas ? 'border-neutral-800' : 'border-slate-100'
                  }`}>
                    <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md border ${
                      isDarkCanvas
                        ? 'bg-neutral-800 border-neutral-700 text-neutral-300'
                        : 'bg-slate-100 border-slate-200 text-slate-700'
                    }`}>
                      Category: {srv.category}
                    </span>

                    <div className="flex items-center gap-2">
                      {isEditMode && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleToggleServiceShowDuration(srv.id)}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer text-xs flex items-center gap-1 ${
                              srv.showDuration === false
                                ? 'bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-neutral-800'
                            }`}
                            title={
                              srv.showDuration === false
                                ? 'Duration is currently hidden on public website. Click to show.'
                                : 'Duration is currently shown on public website. Click to hide.'
                            }
                          >
                            {srv.showDuration === false ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>

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

                      <button
                        type="button"
                        onClick={() => handleOpenBooking(srv)}
                        className="font-extrabold px-3.5 py-2 rounded-xl text-xs shadow-xs transition-transform active:scale-95 flex items-center gap-1.5 cursor-pointer hover:opacity-90"
                        style={{ backgroundColor: activeAccent.primaryHex, color: 'var(--accent-text-color, #ffffff)' }}
                      >
                        <CalendarCheck className="w-3.5 h-3.5 shrink-0" />
                        <span>Book (₹{srv.price})</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/* 4. MASTER STYLISTS & SPECIALISTS SECTION (INLINE EDITABLE) */}
        {/* ============================================================ */}
        {sectionVisibility.stylists && (
          <section className={`p-6 md:p-12 border-b ${
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
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
              {activeStylists.map((st) => (
                <div
                  key={st.id}
                  className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 transition-all shadow-xs ${
                    isDarkCanvas ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-3.5">
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
                  <div className={`pt-2.5 border-t flex items-center justify-between gap-2 ${isDarkCanvas ? 'border-neutral-800' : 'border-slate-100'}`}>
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
                      onClick={() => {
                        setSelectedStylist(st);
                        setIsBookingOpen(true);
                      }}
                      className="w-full text-xs font-extrabold px-4 py-2.5 rounded-xl shadow-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all hover:opacity-90 active:scale-[0.98]"
                      style={{
                        backgroundColor: isDarkCanvas ? '#ffffff' : activeAccent.primaryHex,
                        color: isDarkCanvas ? '#0f172a' : 'var(--accent-text-color, #ffffff)',
                      }}
                    >
                      <span>Select for Service</span>
                      <ChevronRight className="w-4 h-4 shrink-0" />
                    </button>
                  </div>

                </div>
              ))}
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/* 5. CLIENT REVIEWS & TESTIMONIALS SECTION */}
        {/* ============================================================ */}
        {sectionVisibility.testimonials && (
          <section className={`p-6 md:p-12 border-b ${
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(activeReviews || []).map((rev, idx) => (
                <div
                  key={rev.id || idx}
                  className={`p-5 rounded-2xl border flex flex-col justify-between gap-3 transition-all ${
                    isDarkCanvas ? 'bg-neutral-900/60 border-neutral-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-0.5 text-amber-400">
                        {Array.from({ length: rev.rating || 5 }).map((_, i) => (
                          <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
                        ))}
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">{rev.date}</span>
                    </div>

                    <p className={`text-xs italic leading-relaxed ${isDarkCanvas ? 'text-neutral-300' : 'text-slate-700'}`}>
                      "{rev.comment}"
                    </p>
                  </div>

                  <div>
                    <div className="pt-3 border-t border-slate-200/60 dark:border-neutral-800 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-slate-100 border border-slate-200/80">
                          {rev.avatarUrl ? (
                            <img 
                              src={rev.avatarUrl} 
                              alt={rev.name} 
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs uppercase">
                              {rev.name.charAt(0)}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-xs">{rev.name}</div>
                          <div className="text-[10px] text-slate-400">{rev.location || activeProfile.city} • Verified</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 max-w-[120px] truncate">
                        {rev.serviceName || 'Custom Service'}
                      </span>
                    </div>

                    {isEditMode && (
                      <div className="mt-3 pt-2.5 border-t border-slate-150 dark:border-neutral-800 flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleEditTestimonial(rev)}
                          className="px-2 py-1 text-[10px] font-bold text-slate-600 hover:text-amber-700 hover:bg-amber-50 bg-white border border-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTestimonial(rev.id)}
                          className="px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50 hover:border-rose-200 bg-white border border-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
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
              {(standardData.gallery || []).map((photo, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedGalleryPhoto(photo.url)}
                  className="group relative rounded-xl overflow-hidden aspect-4/3 cursor-pointer shadow-xs border border-slate-200 dark:border-neutral-800"
                >
                  <img
                    src={photo.url}
                    alt={photo.title || 'Salon Gallery Photo'}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3 text-white">
                    <span className="text-[11px] font-bold">{photo.title || photo.tag}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/* 7. LOCATION, MAP & WORKING HOURS CARD */}
        {/* ============================================================ */}
        {sectionVisibility.location && (
          <section className={`p-6 md:p-12 ${
            isDarkCanvas ? 'bg-[#0f0f13]' : 'bg-white'
          }`}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Location details */}
              <div className="flex flex-col justify-between gap-4">
                <div>
                  <span 
                    className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: `${activeAccent.primaryHex}18`, color: activeAccent.primaryHex }}
                  >
                    Find Us
                  </span>
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">
                    <InlineEditable
                      value={sectionHeadings.locationTitle}
                      onSave={(val) => setSectionHeadings((prev) => ({ ...prev, locationTitle: String(val) }))}
                      isEditingActive={isEditMode}
                      label="Location Section Heading"
                      tag="span"
                    />
                  </h2>
                  <p className={`text-xs md:text-sm mt-1 leading-relaxed ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-600'}`}>
                    Conveniently located in the heart of {activeProfile.city}. Free parking and valet available for salon clients.
                  </p>
                </div>

                <div className="flex flex-col gap-3 text-xs">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">Studio Address</div>
                      <div className="text-slate-500 dark:text-neutral-400">
                        {activeProfile.address}, {activeProfile.city} - {activeProfile.postalCode}
                      </div>
                      {standardData.landmark && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5 font-medium">
                          Landmark: {standardData.landmark}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">Operating Hours</div>
                      <div className="text-slate-500 dark:text-neutral-400 font-mono text-[11px]">
                        Monday – Saturday: {standardData.openHourText} – {standardData.closeHourText}
                      </div>
                      <div className="text-slate-500 dark:text-neutral-400 font-mono text-[11px]">
                        Sunday: 10:00 AM – 07:00 PM (By Advance Booking)
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Phone className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">Phone & Instant WhatsApp</div>
                      <div className="text-slate-500 dark:text-neutral-400 font-mono">
                        {activeProfile.phone} / {activeProfile.whatsapp}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-neutral-800 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleOpenBooking()}
                    className="font-bold text-xs px-5 py-2.5 rounded-xl text-white shadow-xs cursor-pointer hover:opacity-90"
                    style={{ backgroundColor: activeAccent.primaryHex }}
                  >
                    Schedule Your Appointment
                  </button>

                  <a
                    href={`https://wa.me/${activeProfile.whatsapp.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold px-4 py-2.5 rounded-xl border border-slate-300 dark:border-neutral-700 text-slate-700 dark:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-800 flex items-center gap-1.5 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    <span>WhatsApp Inquiry</span>
                  </a>
                </div>
              </div>

              {/* Map Preview Placeholder Card */}
              <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-neutral-800 bg-slate-100 dark:bg-neutral-900 relative min-h-[260px] flex items-center justify-center p-6 text-center">
                <div className="flex flex-col items-center gap-2 z-10 max-w-xs">
                  <div className="w-12 h-12 rounded-2xl bg-white dark:bg-neutral-800 text-emerald-600 shadow-md flex items-center justify-center">
                    <Navigation className="w-6 h-6 animate-pulse" />
                  </div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white mt-2">
                    {activeProfile.businessName}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    {activeProfile.address}, {activeProfile.city}
                  </p>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(`${activeProfile.businessName} ${activeProfile.address} ${activeProfile.city}`)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 text-xs font-bold px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1.5 shadow-xs"
                  >
                    <span>Open in Google Maps</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                
                {/* Background map grid illustration */}
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#000_1px,transparent_1px)] dark:bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />
              </div>
            </div>
          </section>
        )}

      </div>

      {/* Floating Instant WhatsApp Button */}
      {sectionVisibility.whatsappFloat && (
        <a
          href={`https://wa.me/${activeProfile.whatsapp.replace(/\D/g, '')}?text=Hi%20${encodeURIComponent(activeProfile.businessName)},%20I%20would%20like%20to%20book%20an%20appointment.`}
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-6 right-6 z-40 bg-emerald-500 hover:bg-emerald-600 text-white p-3.5 rounded-full shadow-2xl flex items-center gap-2 transition-all hover:scale-105 active:scale-95 group cursor-pointer"
          title="Chat on WhatsApp"
        >
          <MessageSquare className="w-5 h-5 fill-white" />
          <span className="text-xs font-bold max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 whitespace-nowrap">
            WhatsApp Booking
          </span>
        </a>
      )}

      {/* Booking Modal Flow */}
      <BookingModal
        isOpen={isBookingOpen}
        onClose={() => setIsBookingOpen(false)}
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
      />

      {/* Gallery Lightbox Modal */}
      {selectedGalleryPhoto && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setSelectedGalleryPhoto(null)}
        >
          <div className="relative max-w-2xl max-h-[85vh] rounded-2xl overflow-hidden shadow-2xl bg-black">
            <button
              onClick={() => setSelectedGalleryPhoto(null)}
              className="absolute top-3 right-3 z-10 bg-black/60 text-white p-2 rounded-full hover:bg-black"
            >
              <X className="w-5 h-5" />
            </button>
            <img src={selectedGalleryPhoto} alt="Gallery Zoom" className="w-full h-full object-contain" />
          </div>
        </div>
      )}

      {/* Booking Confirmation Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-6 z-50 max-w-sm w-full bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-700 flex flex-col gap-2.5 animate-in slide-in-from-bottom">
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

    </div>
  );
};
