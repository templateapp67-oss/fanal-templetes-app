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
  ArrowRight
} from 'lucide-react';
import { SalonProfile, SalonService, Stylist, Appointment, BusinessTypeId } from '../types';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';
import { ACCENT_PALETTES, DEFAULT_CATEGORY_ACCENTS, AccentPaletteKey } from '../themeAccents';
import { CATEGORY_STANDARDIZED_DATA } from '../templateData';

interface SalonWebsitePreviewProps {
  profile: SalonProfile;
  services: SalonService[];
  stylists: Stylist[];
  onAddAppointment: (appointment: Appointment) => void;
  onSelectCategory?: (categoryId: BusinessTypeId) => void;
}

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

export const SalonWebsitePreview: React.FC<SalonWebsitePreviewProps> = ({
  profile,
  services,
  stylists,
  onAddAppointment,
  onSelectCategory,
}) => {
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<BusinessTypeId>(profile.businessType || 'hair_salon');
  
  // Active template configuration
  const activeTemplate = CATEGORY_TEMPLATES[selectedCategoryKey] || CATEGORY_TEMPLATES.hair_salon;
  const currentServices = selectedCategoryKey === profile.businessType ? services : activeTemplate.services;
  const currentStylists = selectedCategoryKey === profile.businessType ? stylists : activeTemplate.stylists;

  // Active Accent Palette selection with fallback to category default
  const [selectedAccentKey, setSelectedAccentKey] = useState<AccentPaletteKey>(
    (profile.themeAccentKey as AccentPaletteKey) || DEFAULT_CATEGORY_ACCENTS[selectedCategoryKey] || 'slate'
  );

  const activeAccent = ACCENT_PALETTES[selectedAccentKey] || ACCENT_PALETTES.slate;
  const standardData = CATEGORY_STANDARDIZED_DATA[selectedCategoryKey] || CATEGORY_STANDARDIZED_DATA.hair_salon;

  const currentProfile: SalonProfile = selectedCategoryKey === profile.businessType ? profile : {
    ...profile,
    businessType: activeTemplate.id,
    businessName: activeTemplate.title,
    ownerName: activeTemplate.ownerName,
    ownerRole: activeTemplate.ownerRole,
    phone: activeTemplate.phone,
    whatsapp: activeTemplate.whatsapp,
    tagline: activeTemplate.tagline,
    about: activeTemplate.about,
    ownerPhotoUrl: activeTemplate.ownerPhotoUrl,
    coverImageUrl: activeTemplate.coverImageUrl,
    themePreset: activeTemplate.themePreset,
    currency: '₹',
    subdomain: activeTemplate.id.replace('_', ''),
    address: activeTemplate.defaultAddress,
    city: activeTemplate.defaultCity,
    postalCode: activeTemplate.defaultPostalCode,
    instagramHandle: activeTemplate.instagramHandle,
    landmark: standardData.landmark
  };

  const [activeSubCategory, setActiveSubCategory] = useState<string>('All');
  const [isBookingOpen, setIsBookingOpen] = useState<boolean>(false);
  const [selectedService, setSelectedService] = useState<SalonService>(currentServices[0]);
  const [selectedStylist, setSelectedStylist] = useState<Stylist>(currentStylists[0]);
  const [bookingDate, setBookingDate] = useState<string>('2026-09-05');
  const [bookingTime, setBookingTime] = useState<string>('11:00');
  const [clientName, setClientName] = useState<string>('');
  const [clientPhone, setClientPhone] = useState<string>('');
  const [clientEmail, setClientEmail] = useState<string>('');
  const [bookingSuccess, setBookingSuccess] = useState<boolean>(false);
  const [generatedRefCode, setGeneratedRefCode] = useState<string>('');
  const [selectedGalleryPhoto, setSelectedGalleryPhoto] = useState<string | null>(null);

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
  const [copiedRef, setCopiedRef] = useState<boolean>(false);

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

  const subCategoriesList = ['All', ...activeTemplate.subCategories];

  const filteredServices = activeSubCategory === 'All'
    ? currentServices
    : currentServices.filter((s) => s.category === activeSubCategory);

  const handleCategorySwitch = (catId: BusinessTypeId) => {
    setSelectedCategoryKey(catId);
    const tmpl = CATEGORY_TEMPLATES[catId];
    if (tmpl) {
      setActiveSubCategory('All');
      setSelectedService(tmpl.services[0]);
      setSelectedStylist(tmpl.stylists[0]);
      // Update accent to match new category default
      setSelectedAccentKey(DEFAULT_CATEGORY_ACCENTS[catId] || 'slate');
      if (onSelectCategory) {
        onSelectCategory(catId);
      }
    }
  };

  const handleOpenBooking = (srv?: SalonService) => {
    if (srv) {
      setSelectedService(srv);
    } else {
      setSelectedService(currentServices[0]);
    }
    setSelectedStylist(currentStylists[0]);
    setBookingSuccess(false);
    setIsBookingOpen(true);
  };

  const handleConfirmBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedService || !selectedStylist) return;

    const cityCode = currentProfile.city.includes('Bengaluru') ? 'BLR' 
      : currentProfile.city.includes('Mumbai') ? 'BOM'
      : currentProfile.city.includes('Delhi') ? 'DEL'
      : currentProfile.city.includes('Hyderabad') ? 'HYD'
      : currentProfile.city.includes('Jaipur') ? 'JPR'
      : currentProfile.city.includes('Chennai') ? 'MAA'
      : currentProfile.city.includes('Kochi') ? 'COK'
      : 'IND';

    const refNum = `NX-${cityCode}-${Math.floor(10000 + Math.random() * 90000)}`;
    setGeneratedRefCode(refNum);

    const depositAmount = currentProfile.requireDeposit
      ? Math.round((selectedService.price * (currentProfile.depositPercentage || 20)) / 100)
      : 0;

    const newApt: Appointment = {
      id: `apt-${Date.now()}`,
      clientName: clientName || 'Guest Client',
      clientPhone: clientPhone || '+91 98765 43210',
      clientEmail: clientEmail || 'client@example.in',
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      servicePrice: selectedService.price,
      stylistId: selectedStylist.id,
      stylistName: selectedStylist.name,
      date: bookingDate,
      time: bookingTime,
      status: 'confirmed',
      paymentStatus: currentProfile.requireDeposit ? 'paid_deposit' : 'pay_at_salon',
      amountPaid: depositAmount,
      createdAt: new Date().toISOString()
    };

    onAddAppointment(newApt);
    setBookingSuccess(true);
    setToastMessage({
      id: String(Date.now()),
      title: 'Appointment Confirmed!',
      clientName: newApt.clientName,
      serviceName: newApt.serviceName,
      stylistName: newApt.stylistName,
      dateTime: `${bookingDate} at ${bookingTime}`,
      refCode: refNum,
      price: selectedService.price
    });
  };

  const closeBooking = () => {
    setIsBookingOpen(false);
    setBookingSuccess(false);
    setClientName('');
    setClientPhone('');
    setClientEmail('');
  };

  // Device width classes
  const deviceWidthClass = {
    desktop: 'w-full max-w-[1240px]',
    tablet: 'w-full max-w-[768px]',
    mobile: 'w-full max-w-[390px]'
  }[deviceMode];

  const themeStyle = activeTemplate.themeStyle;
  const isDarkCanvas = themeStyle.isDark || selectedAccentKey === 'obsidian';

  return (
    <div 
      className="min-h-screen pt-24 pb-24 flex flex-col items-center bg-slate-100 text-slate-900 font-sans"
      style={{
        '--theme-primary': activeAccent.primaryHex,
        '--theme-secondary': activeAccent.secondaryHex,
      } as React.CSSProperties}
    >
      
      {/* ============================================================ */}
      {/* 1. TOP CONTROLS & PALETTE / CATEGORY SWITCHER RIBBON */}
      {/* ============================================================ */}
      <div className="w-full bg-white border-b border-slate-200 sticky top-20 z-40 shadow-xs">
        <div className="max-w-[1400px] mx-auto px-4 py-2.5 flex flex-col gap-2">
          
          {/* Upper control row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-700">
                <span>{currentProfile.subdomain}.nexora.in</span>
                <span className="text-slate-400">•</span>
                <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[11px] font-bold">
                  {currentProfile.currency} INR (₹) Live
                </span>
              </div>
            </div>

            {/* Device Modes */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setDeviceMode('desktop')}
                className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  deviceMode === 'desktop' ? 'bg-white shadow-xs text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="material-symbols-outlined text-sm">desktop_windows</span>
                <span className="hidden sm:inline">Desktop</span>
              </button>
              <button
                onClick={() => setDeviceMode('tablet')}
                className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  deviceMode === 'tablet' ? 'bg-white shadow-xs text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="material-symbols-outlined text-sm">tablet_mac</span>
                <span className="hidden sm:inline">Tablet</span>
              </button>
              <button
                onClick={() => setDeviceMode('mobile')}
                className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  deviceMode === 'mobile' ? 'bg-white shadow-xs text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="material-symbols-outlined text-sm">smartphone</span>
                <span className="hidden sm:inline">Mobile</span>
              </button>
            </div>

            {/* Fast Test booking CTA */}
            <button
              onClick={() => handleOpenBooking()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <CalendarCheck className="w-4 h-4" />
              <span>Test Booking Flow (₹)</span>
            </button>
          </div>

          {/* Theme Color Accent Switcher Ribbon */}
          <div className="border-t border-slate-100 pt-2 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Theme Accent:
            </span>
            {Object.values(ACCENT_PALETTES).map((palette) => {
              const isSelected = palette.key === selectedAccentKey;
              return (
                <button
                  key={palette.key}
                  onClick={() => setSelectedAccentKey(palette.key)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs font-bold'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                  title={`${palette.name} (${palette.categoryHint})`}
                >
                  <span
                    className="w-3 h-3 rounded-full border border-white/40 shrink-0 shadow-xs"
                    style={{ backgroundColor: palette.primaryHex }}
                  />
                  <span>{palette.name}</span>
                  {isSelected && <span className="text-[10px] text-emerald-400 font-mono">✓</span>}
                </button>
              );
            })}
          </div>

          {/* 14 Category Switcher Ribbon */}
          <div className="border-t border-slate-100 pt-2 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">category</span>
              14 Templates:
            </span>
            {Object.values(CATEGORY_TEMPLATES).map((tmpl) => {
              const isSelected = tmpl.id === selectedCategoryKey;
              return (
                <button
                  key={tmpl.id}
                  onClick={() => handleCategorySwitch(tmpl.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
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

      {/* ============================================================ */}
      {/* 2. STANDARDIZED SALON WEBSITE CANVAS */}
      {/* ============================================================ */}
      <div className={`mt-6 transition-all duration-300 ${deviceWidthClass} shadow-2xl rounded-2xl overflow-hidden border border-slate-200 my-4 ${
        isDarkCanvas ? 'bg-[#0f0f13] text-neutral-100' : 'bg-white text-slate-900'
      }`}>
        
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
            <span>{currentProfile.city}</span>
          </div>
        </div>

        {/* ============================================================ */}
        {/* SECTION: SALON SITE NAV HEADER & STICKY BOOKING TRIGGER */}
        {/* ============================================================ */}
        <header className={`px-6 md:px-10 py-4 flex justify-between items-center border-b transition-colors ${
          isDarkCanvas ? 'bg-[#121216]/95 backdrop-blur-md border-neutral-800 text-white' : 'bg-white/95 backdrop-blur-md border-slate-100 text-slate-900'
        }`}>
          <div className="flex items-center gap-3">
            <div 
              className="w-11 h-11 rounded-xl flex items-center justify-center font-bold shadow-xs text-white"
              style={{ backgroundColor: activeAccent.primaryHex }}
            >
              <span className="material-symbols-outlined text-2xl">{activeTemplate.icon}</span>
            </div>
            <div>
              <div className="font-bold text-lg md:text-xl tracking-tight leading-snug">
                {currentProfile.businessName}
              </div>
              <div className={`text-[11px] flex items-center gap-1 font-mono ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-500'}`}>
                <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="truncate max-w-[280px] sm:max-w-md">{currentProfile.address}, {currentProfile.city}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden lg:flex flex-col text-right">
              <span className="text-[11px] font-mono text-slate-400">Direct Appointments</span>
              <span className="text-xs font-bold">{currentProfile.phone}</span>
            </div>

            {/* Header Sticky Booking Trigger */}
            <button
              onClick={() => handleOpenBooking()}
              className="font-bold text-xs px-5 py-2.5 rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer text-white hover:opacity-90"
              style={{ backgroundColor: activeAccent.primaryHex }}
            >
              <CalendarCheck className="w-4 h-4" />
              <span>Book Appointment</span>
            </button>
          </div>
        </header>

        {/* ============================================================ */}
        {/* 1. HERO SECTION */}
        {/* ============================================================ */}
        <section className={`relative overflow-hidden transition-all ${
          themeStyle.heroBackground || 'bg-[#0f172a]'
        } text-white`}>
          {/* Background image & gradient overlay */}
          <div className="absolute inset-0 z-0">
            <img
              src={currentProfile.coverImageUrl}
              alt={currentProfile.businessName}
              className="w-full h-full object-cover object-center opacity-30 mix-blend-luminosity filter contrast-125"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/75 to-black/50" />
          </div>

          {/* Hero Content */}
          <div className="relative z-10 px-6 md:px-12 py-14 md:py-20 flex flex-col justify-center max-w-4xl text-white">
            {/* Category badge & highlight tags */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span 
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-bold tracking-wide uppercase shadow-xs text-white"
                style={{ backgroundColor: activeAccent.primaryHex }}
              >
                <span className="material-symbols-outlined text-sm">{activeTemplate.icon}</span>
                <span>{activeTemplate.shortName}</span>
              </span>

              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-xs font-mono">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Verified Indian Salon</span>
              </span>

              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-xs font-mono">
                <MapPin className="w-3.5 h-3.5 text-amber-300" />
                <span>{currentProfile.city}</span>
              </span>
            </div>

            {/* Tagline */}
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight text-balance">
              {currentProfile.tagline}
            </h1>

            {/* Description */}
            <p className="text-sm md:text-base text-slate-200 mt-4 leading-relaxed max-w-2xl">
              {currentProfile.about}
            </p>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/20 text-xs">
              <div>
                <div className="text-white/60 font-mono text-[10px] uppercase">Services from</div>
                <div className="text-xl font-bold font-mono text-emerald-400">
                  {currentProfile.currency}{Math.min(...currentServices.map(s => s.price))}
                </div>
              </div>
              <div>
                <div className="text-white/60 font-mono text-[10px] uppercase">Lead Specialist</div>
                <div className="text-sm font-bold truncate">{currentProfile.ownerName}</div>
              </div>
              <div>
                <div className="text-white/60 font-mono text-[10px] uppercase">Specialty</div>
                <div className="text-sm font-bold truncate">{activeTemplate.subCategories[0]}</div>
              </div>
              <div>
                <div className="text-white/60 font-mono text-[10px] uppercase">Client Rating</div>
                <div className="text-sm font-bold flex items-center gap-1 text-amber-300">
                  <Star className="w-3.5 h-3.5 fill-amber-400" />
                  <span>{standardData.averageRating} ({standardData.totalReviewCount}+ Reviews)</span>
                </div>
              </div>
            </div>

            {/* Primary Action Buttons */}
            <div className="flex flex-wrap items-center gap-3.5 mt-8">
              <button
                onClick={() => handleOpenBooking()}
                className="font-bold text-sm px-6 py-3.5 rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer text-white hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
                style={{ backgroundColor: activeAccent.primaryHex }}
              >
                <span>Book Now in {currentProfile.currency}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <a
                href={`https://wa.me/${currentProfile.whatsapp.replace(/\D/g, '')}?text=Hello%20${encodeURIComponent(currentProfile.businessName)},%20I%20would%20like%20to%20inquire%20about%20booking%20an%20appointment.`}
                target="_blank"
                rel="noreferrer"
                className="bg-emerald-600/90 hover:bg-emerald-600 text-white font-medium text-xs px-5 py-3.5 rounded-xl border border-emerald-500/30 flex items-center gap-2 transition-all cursor-pointer"
              >
                <MessageSquare className="w-4 h-4" />
                <span>WhatsApp Us ({currentProfile.whatsapp})</span>
              </a>
            </div>

          </div>
        </section>

        {/* Location Banner Bar with Live Hours */}
        <div className={`px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs border-b ${
          isDarkCanvas ? 'bg-[#15151c] border-neutral-800 text-neutral-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0">
              <MapPin className="w-3.5 h-3.5" />
            </span>
            <span>
              <strong>Salon Location:</strong> {currentProfile.address}, {currentProfile.city} - <span className="font-mono">{currentProfile.postalCode}</span>
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
              {standardData.specialties.map((spec, idx) => (
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
                    src={currentProfile.ownerPhotoUrl}
                    alt={currentProfile.ownerName}
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
                  <span className="font-bold text-sm block">{currentProfile.ownerName}</span>
                  <span className="text-xs text-slate-500 font-mono">{currentProfile.ownerRole}</span>
                </div>
              </div>
            </div>

            {/* 4 Hygiene & Quality Certification Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {standardData.certifications.map((cert, idx) => (
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

        {/* ============================================================ */}
        {/* 3. SERVICES & PRICING MENU SECTION */}
        {/* ============================================================ */}
        <section className={`p-6 md:p-12 border-b ${
          isDarkCanvas ? 'bg-[#0f0f13] border-neutral-800' : 'bg-white border-slate-200'
        }`}>
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
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1.5">
                Curated Services & Transparent Indian Rupee (₹) Pricing
              </h2>
            </div>

            {/* Sub-Category Filter Tabs */}
            <div className="flex flex-wrap gap-1.5">
              {subCategoriesList.map((cat) => {
                const isActive = activeSubCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveSubCategory(cat)}
                    className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer border ${
                      isActive
                        ? 'text-white border-transparent shadow-xs'
                        : isDarkCanvas
                          ? 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:bg-neutral-800'
                          : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                    }`}
                    style={isActive ? { backgroundColor: activeAccent.primaryHex } : {}}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Standardized Responsive Service Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredServices.map((srv) => (
              <div
                key={srv.id}
                className={`p-6 rounded-2xl border hover:shadow-md transition-all flex flex-col justify-between gap-4 ${
                  isDarkCanvas 
                    ? 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700' 
                    : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                }`}
              >
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span 
                        className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                        style={{ backgroundColor: `${activeAccent.primaryHex}18`, color: activeAccent.primaryHex }}
                      >
                        {srv.category}
                      </span>
                      {srv.popular && (
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                          Signature Choice
                        </span>
                      )}
                    </div>
                    <h3 className={`font-bold text-base md:text-lg leading-snug ${isDarkCanvas ? 'text-white' : 'text-slate-900'}`}>
                      {srv.name}
                    </h3>
                    <p className={`text-xs mt-2 leading-relaxed ${isDarkCanvas ? 'text-neutral-400' : 'text-slate-600'}`}>
                      {srv.description}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <div 
                      className="font-mono text-xl md:text-2xl font-extrabold"
                      style={{ color: activeAccent.primaryHex }}
                    >
                      ₹{srv.price.toLocaleString('en-IN')}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                      {srv.durationMinutes} mins
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-neutral-800 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Duration: {srv.durationMinutes} mins</span>
                  </span>

                  {/* Section Level Direct Booking Trigger */}
                  <button
                    onClick={() => handleOpenBooking(srv)}
                    className="px-4 py-2 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1 cursor-pointer text-white hover:opacity-90"
                    style={{ backgroundColor: activeAccent.primaryHex }}
                  >
                    <span>Book Now (₹{srv.price})</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ============================================================ */}
        {/* 4. GALLERY SHOWCASE SECTION */}
        {/* ============================================================ */}
        <section className={`p-6 md:p-12 border-b ${
          isDarkCanvas ? 'bg-[#15151c] border-neutral-800' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
              <div>
                <span 
                  className="text-xs font-mono font-bold uppercase tracking-wider px-3 py-1 rounded-full inline-block mb-1.5"
                  style={{ backgroundColor: `${activeAccent.primaryHex}18`, color: activeAccent.primaryHex }}
                >
                  Visual Portfolio
                </span>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                  Recent Work, Studio Spaces & Transformations
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Authentic work performed by our verified artists in {currentProfile.city}.
                </p>
              </div>

              <button
                onClick={() => handleOpenBooking()}
                className="text-xs font-bold px-4 py-2.5 rounded-xl border border-slate-300 hover:border-slate-400 transition-colors flex items-center gap-1.5 w-fit cursor-pointer"
              >
                <span>Book This Aesthetic</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 6-Photo Clean Responsive Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {standardData.gallery.map((photo) => (
                <div
                  key={photo.id}
                  onClick={() => setSelectedGalleryPhoto(photo.url)}
                  className={`group relative rounded-2xl overflow-hidden border cursor-pointer aspect-4/3 shadow-xs hover:shadow-lg transition-all ${
                    isDarkCanvas ? 'border-neutral-800 bg-neutral-900' : 'border-slate-200 bg-white'
                  }`}
                >
                  <img
                    src={photo.url}
                    alt={photo.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-80 group-hover:opacity-95 transition-opacity" />
                  
                  <div className="absolute top-3 left-3">
                    <span 
                      className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md text-white shadow-xs backdrop-blur-md"
                      style={{ backgroundColor: activeAccent.primaryHex }}
                    >
                      {photo.tag}
                    </span>
                  </div>

                  <div className="absolute bottom-3 left-3 right-3 text-white">
                    <h4 className="font-bold text-sm leading-tight drop-shadow-sm">{photo.title}</h4>
                    <p className="text-[11px] text-slate-300 flex items-center gap-1 mt-0.5">
                      <span>Tap to preview full resolution</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </section>

        {/* ============================================================ */}
        {/* 5. REVIEWS & RATINGS SECTION */}
        {/* ============================================================ */}
        <section className={`p-6 md:p-12 border-b ${
          isDarkCanvas ? 'bg-[#0f0f13] border-neutral-800' : 'bg-white border-slate-200'
        }`}>
          <div className="max-w-5xl mx-auto">
            
            {/* Reviews Aggregate Header */}
            <div className={`p-6 md:p-8 rounded-2xl border mb-8 flex flex-col md:flex-row items-center justify-between gap-6 ${
              isDarkCanvas ? 'bg-neutral-900/80 border-neutral-800' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
                <div 
                  className="w-20 h-20 rounded-2xl flex flex-col items-center justify-center text-white shadow-md shrink-0"
                  style={{ backgroundColor: activeAccent.primaryHex }}
                >
                  <span className="text-2xl font-extrabold font-mono leading-none">★ {standardData.averageRating}</span>
                  <span className="text-[10px] font-mono mt-1 opacity-90">OUT OF 5.0</span>
                </div>
                <div>
                  <h3 className="text-lg md:text-xl font-extrabold">Verified Client Testimonials</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Based on {standardData.totalReviewCount}+ verified Google & WhatsApp appointments in {currentProfile.city}.
                  </p>
                  <div className="flex items-center gap-1 text-amber-400 mt-2">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} className="w-4 h-4 fill-amber-400" />
                    ))}
                    <span className="text-xs font-bold text-slate-700 dark:text-neutral-300 ml-1">100% Verified</span>
                  </div>
                </div>
              </div>

              {/* Metrics Pills */}
              <div className="grid grid-cols-3 gap-2 w-full md:w-auto text-center font-mono">
                <div className={`p-3 rounded-xl border ${isDarkCanvas ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-slate-200'}`}>
                  <div className="font-extrabold text-emerald-600 text-sm">99%</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Hygiene Score</div>
                </div>
                <div className={`p-3 rounded-xl border ${isDarkCanvas ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-slate-200'}`}>
                  <div className="font-extrabold text-emerald-600 text-sm">98%</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">On-Time Starts</div>
                </div>
                <div className={`p-3 rounded-xl border ${isDarkCanvas ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-slate-200'}`}>
                  <div className="font-extrabold text-emerald-600 text-sm">86%</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Repeat Clients</div>
                </div>
              </div>
            </div>

            {/* 3 Verified Testimonial Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {standardData.reviews.map((rev) => (
                <div
                  key={rev.id}
                  className={`p-5 rounded-2xl border flex flex-col justify-between gap-4 ${
                    isDarkCanvas ? 'bg-neutral-900/50 border-neutral-800' : 'bg-white border-slate-200 shadow-xs'
                  }`}
                >
                  <div className="flex flex-col gap-2.5">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-1 text-amber-400">
                        {[...Array(rev.rating)].map((_, i) => (
                          <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
                        ))}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">{rev.date}</span>
                    </div>

                    <p className={`text-xs leading-relaxed italic ${isDarkCanvas ? 'text-neutral-300' : 'text-slate-700'}`}>
                      "{rev.comment}"
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-neutral-800 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-xs">{rev.name}</div>
                      <div className="text-[10px] text-slate-400">{rev.location}</div>
                    </div>

                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      ✓ Verified
                    </span>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </section>

        {/* ============================================================ */}
        {/* 6. WORKING HOURS & 7. CONTACT & 8. GOOGLE MAPS LOCATION */}
        {/* ============================================================ */}
        <section className={`p-6 md:p-12 border-b ${
          isDarkCanvas ? 'bg-[#15151c] border-neutral-800' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* 6. WORKING HOURS & LIVE STATUS (Col 4) */}
            <div className={`lg:col-span-4 p-6 rounded-2xl border flex flex-col justify-between gap-4 ${
              isDarkCanvas ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-emerald-600" />
                    <h3 className="font-bold text-base">Working Hours</h3>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Open Now</span>
                  </span>
                </div>

                <div className="flex flex-col gap-2.5 text-xs font-mono">
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-neutral-800">
                    <span className="text-slate-500">Monday – Friday</span>
                    <span className="font-bold">10:00 AM – 08:30 PM</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-neutral-800">
                    <span className="text-slate-500">Saturday</span>
                    <span className="font-bold">09:30 AM – 09:00 PM</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-500">Sunday</span>
                    <span className="font-bold">10:00 AM – 08:00 PM</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-neutral-800">
                <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                  ⚡ Advance appointments receive priority seating. Walk-ins accommodated based on specialist availability.
                </p>
                <button
                  onClick={() => handleOpenBooking()}
                  className="w-full py-2.5 rounded-xl font-bold text-xs text-white shadow-xs transition-opacity hover:opacity-90 cursor-pointer flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: activeAccent.primaryHex }}
                >
                  <CalendarCheck className="w-4 h-4" />
                  <span>Reserve Desired Slot</span>
                </button>
              </div>
            </div>

            {/* 7. CONTACT DETAILS & SPECIALIST ASSISTANCE (Col 4) */}
            <div className={`lg:col-span-4 p-6 rounded-2xl border flex flex-col justify-between gap-4 ${
              isDarkCanvas ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Phone className="w-5 h-5" style={{ color: activeAccent.primaryHex }} />
                  <h3 className="font-bold text-base">Contact Information</h3>
                </div>

                <div className="flex flex-col gap-3 text-xs">
                  {/* Phone */}
                  <a
                    href={`tel:${currentProfile.phone.replace(/\s+/g, '')}`}
                    className={`p-3 rounded-xl border flex items-center gap-3 transition-colors ${
                      isDarkCanvas ? 'bg-neutral-800/60 border-neutral-700 hover:bg-neutral-800' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-600 flex items-center justify-center shrink-0">
                      <Phone className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-slate-400 uppercase">Direct Phone</div>
                      <div className="font-bold text-xs truncate">{currentProfile.phone}</div>
                    </div>
                  </a>

                  {/* WhatsApp */}
                  <a
                    href={`https://wa.me/${currentProfile.whatsapp.replace(/\D/g, '')}?text=Hello%20${encodeURIComponent(currentProfile.businessName)},%20I%20would%20like%20to%20inquire%20about%20booking.`}
                    target="_blank"
                    rel="noreferrer"
                    className={`p-3 rounded-xl border flex items-center gap-3 transition-colors ${
                      isDarkCanvas ? 'bg-neutral-800/60 border-neutral-700 hover:bg-neutral-800' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-slate-400 uppercase">WhatsApp Instant Chat</div>
                      <div className="font-bold text-xs truncate">{currentProfile.whatsapp}</div>
                    </div>
                  </a>

                  {/* Email */}
                  <a
                    href={`mailto:${currentProfile.email || 'appointments@' + currentProfile.subdomain + '.in'}`}
                    className={`p-3 rounded-xl border flex items-center gap-3 transition-colors ${
                      isDarkCanvas ? 'bg-neutral-800/60 border-neutral-700 hover:bg-neutral-800' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-600 flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-slate-400 uppercase">Official Email</div>
                      <div className="font-bold text-xs truncate">{currentProfile.email || 'appointments@' + currentProfile.subdomain + '.in'}</div>
                    </div>
                  </a>
                </div>
              </div>

              {/* Primary Contact Person */}
              <div className="pt-3 border-t border-slate-100 dark:border-neutral-800 flex items-center gap-3">
                <img
                  src={currentProfile.ownerPhotoUrl}
                  alt={currentProfile.ownerName}
                  className="w-10 h-10 rounded-full object-cover border"
                />
                <div className="min-w-0 text-xs">
                  <span className="font-bold block truncate">{currentProfile.ownerName}</span>
                  <span className="text-[11px] text-slate-400 block truncate">{currentProfile.ownerRole}</span>
                </div>
              </div>
            </div>

            {/* 8. GOOGLE MAPS LOCATION (Col 4) */}
            <div className={`lg:col-span-4 p-6 rounded-2xl border flex flex-col justify-between gap-4 ${
              isDarkCanvas ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Navigation className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold text-base">Google Maps Location</h3>
                </div>

                {/* Simulated Interactive Map Container */}
                <div className="relative w-full h-36 rounded-xl overflow-hidden border border-slate-200 dark:border-neutral-700 bg-slate-200 dark:bg-neutral-800 mb-3 shadow-inner">
                  {/* Grid Lines simulating city streets */}
                  <div className="absolute inset-0 opacity-40 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:16px_16px]" />
                  <div className="absolute w-full h-1 bg-slate-400/40 top-1/2 -rotate-6" />
                  <div className="absolute w-1 h-full bg-slate-400/40 left-1/3 rotate-12" />

                  {/* Pulsing Salon Pin Marker */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                    <span 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-lg animate-bounce"
                      style={{ backgroundColor: activeAccent.primaryHex }}
                    >
                      <MapPin className="w-4 h-4 fill-white" />
                    </span>
                    <span className="mt-1 px-2 py-0.5 rounded bg-slate-900/90 text-white font-mono text-[9px] font-bold shadow-md whitespace-nowrap">
                      {currentProfile.businessName.split(' ')[0]}
                    </span>
                  </div>

                  <div className="absolute bottom-2 left-2 bg-white/90 dark:bg-black/90 px-2 py-0.5 rounded text-[9px] font-mono text-slate-700 dark:text-slate-300">
                    📍 {currentProfile.city.split(',')[0]}
                  </div>
                </div>

                <div className="text-xs space-y-1">
                  <div className="font-bold leading-snug">{currentProfile.address}</div>
                  <div className="text-slate-500 text-[11px] font-mono">{currentProfile.city} - {currentProfile.postalCode}</div>
                  <div className="text-slate-500 text-[11px] pt-1">
                    <strong>Landmark:</strong> {standardData.landmark}
                  </div>
                  <div className="text-emerald-700 dark:text-emerald-400 text-[10px] font-medium pt-0.5">
                    ✓ {standardData.parkingInfo}
                  </div>
                </div>
              </div>

              {/* Directions Button */}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(currentProfile.businessName + ' ' + currentProfile.address + ' ' + currentProfile.city)}`}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 rounded-xl border border-slate-300 dark:border-neutral-700 hover:bg-slate-100 dark:hover:bg-neutral-800 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Get Directions on Google Maps</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

          </div>
        </section>

        {/* ============================================================ */}
        {/* FOOTER */}
        {/* ============================================================ */}
        <footer className={`p-6 md:p-10 border-t flex flex-col sm:flex-row items-center justify-between gap-4 text-xs ${
          isDarkCanvas ? 'bg-[#0a0a0d] border-neutral-800 text-neutral-400' : 'bg-white border-slate-200 text-slate-600'
        }`}>
          <div>
            <span className="font-bold text-slate-900 dark:text-white">{currentProfile.businessName}</span>
            <span className="text-slate-400"> • All rights reserved © 2026. Official Indian Salon Portal.</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px]">
            <span>Powered by Nexora SaaS</span>
            <span>•</span>
            <button
              onClick={() => handleOpenBooking()}
              className="font-bold underline hover:opacity-80 cursor-pointer"
              style={{ color: activeAccent.primaryHex }}
            >
              Instant Booking (₹)
            </button>
          </div>
        </footer>

      </div>

      {/* ============================================================ */}
      {/* 9. STICKY MOBILE / VIEWPORT FLOATING BOOKING BAR */}
      {/* ============================================================ */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-4 py-2.5 shadow-2xl flex items-center justify-between sm:hidden">
        <div>
          <div className="font-bold text-xs truncate max-w-[170px] text-slate-900 dark:text-white">
            {currentProfile.businessName}
          </div>
          <div className="text-[11px] font-mono text-emerald-600 font-bold">
            From ₹{Math.min(...currentServices.map(s => s.price))}
          </div>
        </div>

        <button
          onClick={() => handleOpenBooking()}
          className="text-white text-xs font-bold px-4 py-2 rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
          style={{ backgroundColor: activeAccent.primaryHex }}
        >
          <CalendarCheck className="w-3.5 h-3.5" />
          <span>Book Now (₹)</span>
        </button>
      </div>

      {/* ============================================================ */}
      {/* GALLERY PHOTO LIGHTBOX MODAL */}
      {/* ============================================================ */}
      {selectedGalleryPhoto && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md cursor-pointer"
          onClick={() => setSelectedGalleryPhoto(null)}
        >
          <div className="relative max-w-4xl max-h-[85vh] rounded-2xl overflow-hidden shadow-2xl border border-white/20">
            <img 
              src={selectedGalleryPhoto} 
              alt="Gallery Preview" 
              className="w-full h-full object-contain max-h-[80vh]"
            />
            <button
              onClick={() => setSelectedGalleryPhoto(null)}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* INTERACTIVE BOOKING FLOW MODAL WITH INDIAN ADDRESS & ₹ PRICING */}
      {/* ============================================================ */}
      {isBookingOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeBooking();
          }}
        >
          <div 
            className="bg-white border border-slate-200 rounded-2xl w-[92%] sm:w-[90%] md:w-[600px] max-w-[600px] p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[88vh] my-auto overflow-hidden shrink-0 relative"
            onClick={(e) => e.stopPropagation()}
          >
            
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <span 
                  className="w-9 h-9 rounded-xl text-white flex items-center justify-center shadow-xs"
                  style={{ backgroundColor: activeAccent.primaryHex }}
                >
                  <CalendarCheck className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="font-bold text-base text-slate-900 leading-tight">
                    {bookingSuccess ? 'Booking Confirmed!' : 'Book Appointment (₹)'}
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {currentProfile.businessName}
                  </p>
                </div>
              </div>
              <button
                onClick={closeBooking}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Indian Location Badge within Modal */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-slate-700 shrink-0">
              <MapPin className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-bold text-slate-900 truncate">{currentProfile.businessName}</div>
                <div className="text-slate-500 text-[11px] leading-relaxed">{currentProfile.address}, {currentProfile.city} - PIN: {currentProfile.postalCode}</div>
              </div>
            </div>

            {bookingSuccess ? (
              /* Success confirmation view with animation */
              <motion.div 
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25 }}
                className="w-full flex flex-col items-center justify-center py-4 text-center gap-4 overflow-y-auto pr-1"
              >
                <div className="relative flex items-center justify-center">
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0.8 }}
                    animate={{ scale: [0.8, 1.35, 1.2], opacity: [0.6, 0.2, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                    className="absolute w-20 h-20 rounded-full bg-emerald-400 -z-10"
                  />
                  <motion.div
                    initial={{ scale: 0, rotate: -25 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 20 }}
                    className="w-16 h-16 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30 relative"
                  >
                    <CheckCircle2 className="w-9 h-9" />
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: [0, 1.25, 1] }}
                      transition={{ delay: 0.25 }}
                      className="absolute -top-1.5 -right-1.5 bg-amber-400 text-slate-950 p-1 rounded-full shadow-xs"
                    >
                      <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                    </motion.span>
                  </motion.div>
                </div>

                <div>
                  <h4 className="font-bold text-2xl text-slate-900">You're All Set!</h4>
                  <p className="text-xs text-slate-600 max-w-sm mt-1 leading-relaxed">
                    Your appointment for <strong className="text-slate-900">{selectedService.name}</strong> with <strong className="text-slate-900">{selectedStylist.name}</strong> is scheduled for <strong className="text-slate-900">{bookingDate} at {bookingTime}</strong>.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs w-full text-left font-mono flex flex-col gap-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-sans">Booking Reference:</span>
                    <div className="flex items-center gap-1.5">
                      <strong className="text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">{generatedRefCode}</strong>
                      <button
                        type="button"
                        onClick={() => handleCopyRefCode(generatedRefCode)}
                        className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                        title="Copy code"
                      >
                        {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-sans">Service Fee:</span>
                    <strong className="text-emerald-700 font-bold text-sm">₹{selectedService.price.toLocaleString('en-IN')}</strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-sans">Deposit Paid:</span>
                    <strong className="text-slate-800">₹{Math.round((selectedService.price * 20) / 100).toLocaleString('en-IN')} (UPI / Card)</strong>
                  </div>
                  <div className="pt-2 border-t border-slate-200 text-[11px] text-emerald-700 flex items-center gap-1.5 font-sans font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Confirmation WhatsApp sent to {clientPhone || currentProfile.phone}</span>
                  </div>
                </div>

                <div className="flex gap-2 w-full pt-1">
                  <button
                    type="button"
                    onClick={closeBooking}
                    className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold transition-colors cursor-pointer"
                  >
                    Close Window
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBookingSuccess(false);
                      setClientName('');
                      setClientPhone('');
                      setClientEmail('');
                    }}
                    className="flex-1 py-2.5 rounded-xl text-white text-xs font-bold transition-all shadow-xs cursor-pointer hover:opacity-90"
                    style={{ backgroundColor: activeAccent.primaryHex }}
                  >
                    Book Another Service
                  </button>
                </div>
              </motion.div>
            ) : (
              /* Booking input form */
              <form onSubmit={handleConfirmBooking} className="flex flex-col gap-3.5 overflow-y-auto pr-1">
                
                {/* 1. Service Selection */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Selected Service (Indian Rupee ₹ Pricing)
                  </label>
                  <select
                    value={selectedService.id}
                    onChange={(e) => {
                      const found = currentServices.find(s => s.id === e.target.value);
                      if (found) setSelectedService(found);
                    }}
                    className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-white font-medium focus:ring-2 focus:ring-slate-900 outline-none"
                  >
                    {currentServices.map((srv) => (
                      <option key={srv.id} value={srv.id}>
                        {srv.name} — ₹{srv.price.toLocaleString('en-IN')} ({srv.durationMinutes} mins)
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Stylist Selection */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Select Specialist
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {currentStylists.map((st) => {
                      const isSelected = selectedStylist.id === st.id;
                      return (
                        <div
                          key={st.id}
                          onClick={() => setSelectedStylist(st)}
                          className={`p-2 rounded-xl border cursor-pointer flex items-center gap-2 transition-all ${
                            isSelected 
                              ? 'border-slate-900 bg-slate-50 shadow-xs ring-1 ring-slate-900' 
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <img
                            src={st.avatarUrl}
                            alt={st.name}
                            className="w-8 h-8 rounded-full object-cover shrink-0"
                          />
                          <div className="min-w-0 text-left">
                            <div className="font-bold text-[11px] truncate">{st.name.split(' ')[0]}</div>
                            <div className="text-[10px] text-slate-500 truncate">★ {st.rating}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Date & Time Selection */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Date</label>
                    <input
                      type="date"
                      required
                      value={bookingDate}
                      onChange={(e) => setBookingDate(e.target.value)}
                      className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-white font-mono focus:ring-2 focus:ring-slate-900 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Preferred Time</label>
                    <select
                      value={bookingTime}
                      onChange={(e) => setBookingTime(e.target.value)}
                      className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-white font-mono focus:ring-2 focus:ring-slate-900 outline-none"
                    >
                      {['10:00', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30', '19:30'].map((t) => (
                        <option key={t} value={t}>{t} (IST)</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 4. Client Contact Details */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700">Client Details</label>
                  <input
                    type="text"
                    required
                    placeholder="Full Name (e.g. Aarti Sharma)"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="tel"
                      required
                      placeholder="WhatsApp Mobile (+91 98765...)"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-white font-mono focus:ring-2 focus:ring-slate-900 outline-none"
                    />
                    <input
                      type="email"
                      placeholder="Email Address (Optional)"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                    />
                  </div>
                </div>

                {/* Price & Deposit Summary */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs flex flex-col gap-1.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-sans">Service Total:</span>
                    <strong className="font-bold">₹{selectedService.price.toLocaleString('en-IN')}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-sans">20% Advance UPI Deposit:</span>
                    <strong className="text-emerald-700">₹{Math.round((selectedService.price * 20) / 100).toLocaleString('en-IN')}</strong>
                  </div>
                  <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200 font-sans">
                    Remaining ₹{Math.round((selectedService.price * 80) / 100).toLocaleString('en-IN')} payable at salon reception.
                  </div>
                </div>

                {/* Submit Trigger */}
                <button
                  type="submit"
                  className="w-full py-3 rounded-xl font-bold text-xs text-white shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer hover:opacity-90 active:scale-[0.99]"
                  style={{ backgroundColor: activeAccent.primaryHex }}
                >
                  <CalendarCheck className="w-4 h-4" />
                  <span>Confirm Slot & Generate Booking Pass (₹)</span>
                </button>
              </form>
            )}

          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* FLOATING SUCCESS TOAST MESSAGE OVERLAY */}
      {/* ============================================================ */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -25, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 380, damping: 24 }}
            className="fixed top-5 right-5 sm:right-6 z-[80] w-[calc(100%-2.5rem)] sm:w-[420px] max-w-full bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700/70 overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/15 rounded-full blur-2xl pointer-events-none" />

            <div className="p-4 flex items-start gap-3.5 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="w-6 h-6 animate-pulse" />
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm text-white tracking-tight">
                      {toastMessage.title}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      <Sparkles className="w-2.5 h-2.5" />
                      ₹{toastMessage.price.toLocaleString('en-IN')}
                    </span>
                  </div>

                  <button
                    onClick={() => setToastMessage(null)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Dismiss"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-slate-300 line-clamp-1">
                  <strong className="text-white">{toastMessage.clientName}</strong> booked <span className="text-emerald-300 font-medium">{toastMessage.serviceName}</span>
                </p>

                <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <CalendarCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>{toastMessage.dateTime} • {toastMessage.stylistName}</span>
                </div>

                {/* Reference Code Chip */}
                <div className="mt-1 pt-1.5 border-t border-slate-800 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 font-mono">
                    Ref: <strong className="text-slate-200">{toastMessage.refCode}</strong>
                  </span>
                  <button
                    onClick={() => handleCopyRefCode(toastMessage.refCode)}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                  >
                    {copiedRef ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Countdown timer line */}
            <motion.div
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: 5.5, ease: 'linear' }}
              className="h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300"
            />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};
