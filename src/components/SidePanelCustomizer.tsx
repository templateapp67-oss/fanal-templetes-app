import React, { useState, useEffect } from 'react';
import { 
  Palette, 
  MapPin, 
  Sliders, 
  Sparkles, 
  Check, 
  ChevronRight, 
  ChevronLeft, 
  X, 
  Eye, 
  EyeOff, 
  Building, 
  Phone, 
  MessageSquare, 
  Instagram, 
  Moon, 
  Sun, 
  RotateCcw,
  Wand2,
  Share2,
  CheckCircle2
} from 'lucide-react';
import { SalonProfile, BusinessTypeId } from '../types';
import { ACCENT_PALETTES, AccentPaletteKey } from '../themeAccents';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';

export interface SectionVisibilityState {
  header: boolean;
  hero: boolean;
  metrics: boolean;
  about: boolean;
  services: boolean;
  stylists: boolean;
  testimonials: boolean;
  gallery: boolean;
  location: boolean;
  whatsappFloat: boolean;
}

export const DEFAULT_SECTION_VISIBILITY: SectionVisibilityState = {
  header: true,
  hero: true,
  metrics: true,
  about: true,
  services: true,
  stylists: true,
  testimonials: true,
  gallery: true,
  location: true,
  whatsappFloat: true
};

const INDIAN_MAJOR_CITIES = [
  'Bengaluru, Karnataka',
  'Mumbai, Maharashtra',
  'New Delhi, Delhi NCR',
  'Hyderabad, Telangana',
  'Chennai, Tamil Nadu',
  'Kolkata, West Bengal',
  'Pune, Maharashtra',
  'Jaipur, Rajasthan',
  'Kochi, Kerala',
  'Ahmedabad, Gujarat',
  'Chandigarh, Punjab',
  'Goa (Panaji / Candolim)',
  'Indore, Madhya Pradesh',
  'Lucknow, Uttar Pradesh'
];

interface SidePanelCustomizerProps {
  isOpen: boolean;
  onToggle: () => void;
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  selectedCategoryKey: BusinessTypeId;
  selectedAccentKey: AccentPaletteKey;
  setSelectedAccentKey: (key: AccentPaletteKey) => void;
  primaryAccentColor: string;
  isDarkCanvas: boolean;
  setIsDarkCanvas: (dark: boolean) => void;
  sectionVisibility: SectionVisibilityState;
  setSectionVisibility: React.Dispatch<React.SetStateAction<SectionVisibilityState>>;
  onAIGeneratePrompt?: (promptType: string, customPrompt?: string) => void;
  onResetDefaults?: () => void;
}

type CustomizerTab = 'theme' | 'location' | 'sections' | 'ai';

export const SidePanelCustomizer: React.FC<SidePanelCustomizerProps> = ({
  isOpen,
  onToggle,
  profile,
  setProfile,
  selectedCategoryKey,
  selectedAccentKey,
  setSelectedAccentKey,
  primaryAccentColor,
  isDarkCanvas,
  setIsDarkCanvas,
  sectionVisibility,
  setSectionVisibility,
  onAIGeneratePrompt,
  onResetDefaults
}) => {
  const [activeTab, setActiveTab] = useState<CustomizerTab>('theme');
  const [customHex, setCustomHex] = useState<string>(primaryAccentColor || '#0f172a');
  const [aiCustomText, setAiCustomText] = useState<string>('');
  const [toastNotice, setToastNotice] = useState<string | null>(null);

  useEffect(() => {
    if (primaryAccentColor) {
      setCustomHex(primaryAccentColor);
    }
  }, [primaryAccentColor]);

  const showToast = (msg: string) => {
    setToastNotice(msg);
    setTimeout(() => setToastNotice(null), 3000);
  };

  const handleCustomColorApply = (hex: string) => {
    setCustomHex(hex);
    setProfile((prev) => ({
      ...prev,
      customAccentColor: hex
    }));
    showToast(`Accent color updated to ${hex}`);
  };

  const handleSelectPalette = (key: AccentPaletteKey) => {
    setSelectedAccentKey(key);
    const pal = ACCENT_PALETTES[key];
    if (pal) {
      setCustomHex(pal.primaryHex);
      setProfile((prev) => ({
        ...prev,
        themeAccentKey: key,
        customAccentColor: undefined // Clear override to follow palette
      }));
      showToast(`Applied ${pal.name} theme palette`);
    }
  };

  const handleToggleSection = (sectionKey: keyof SectionVisibilityState) => {
    const isVisible = !!sectionVisibility[sectionKey];
    setSectionVisibility((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
    showToast(`Section "${sectionKey}" ${!isVisible ? 'visible' : 'hidden'}`);
  };

  const handleCitySelect = (cityString: string) => {
    const cityName = cityString.split(',')[0].trim();
    setProfile((prev) => ({
      ...prev,
      city: cityName
    }));
    showToast(`Location set to ${cityName}`);
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed right-0 top-36 z-40 bg-slate-900 hover:bg-slate-800 text-white p-2.5 rounded-l-2xl shadow-2xl flex items-center gap-2 border-y border-l border-slate-700 transition-all hover:pl-3 cursor-pointer group"
        title="Open Visual Customizer Side-Panel"
        id="open-customizer-btn"
      >
        <Sliders className="w-4 h-4 text-amber-400 group-hover:rotate-45 transition-transform" />
        <span className="text-xs font-bold [writing-mode:vertical-lr] rotate-180 py-1 tracking-wider uppercase">
          Customize
        </span>
      </button>
    );
  }

  return (
    <aside 
      className="fixed right-0 top-20 bottom-0 z-40 w-80 sm:w-96 bg-white border-l border-slate-200 shadow-2xl flex flex-col transition-all duration-300 animate-in slide-in-from-right font-sans"
      id="side-panel-customizer"
    >
      {/* Toast Notification */}
      {toastNotice && (
        <div className="absolute top-14 left-4 right-4 z-50 bg-slate-900 text-white text-[11px] font-medium py-2 px-3 rounded-xl shadow-xl flex items-center gap-2 border border-slate-700">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">{toastNotice}</span>
        </div>
      )}

      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center shadow-xs">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900">Visual Customizer</h3>
            <p className="text-[11px] text-slate-500">100% Real-Time Live Reflection</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onResetDefaults && (
            <button
              onClick={onResetDefaults}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-colors"
              title="Reset to Template Defaults"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
            title="Close Customizer Panel"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="grid grid-cols-4 p-1.5 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-600">
        <button
          onClick={() => setActiveTab('theme')}
          className={`py-2 px-1 rounded-lg flex flex-col items-center gap-1 transition-all cursor-pointer ${
            activeTab === 'theme' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          <span className="text-[10px]">Theme</span>
        </button>

        <button
          onClick={() => setActiveTab('location')}
          className={`py-2 px-1 rounded-lg flex flex-col items-center gap-1 transition-all cursor-pointer ${
            activeTab === 'location' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          <span className="text-[10px]">Location</span>
        </button>

        <button
          onClick={() => setActiveTab('sections')}
          className={`py-2 px-1 rounded-lg flex flex-col items-center gap-1 transition-all cursor-pointer ${
            activeTab === 'sections' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span className="text-[10px]">Sections</span>
        </button>

        <button
          onClick={() => setActiveTab('ai')}
          className={`py-2 px-1 rounded-lg flex flex-col items-center gap-1 transition-all cursor-pointer ${
            activeTab === 'ai' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-[10px]">AI Studio</span>
        </button>
      </div>

      {/* Tab Content Body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5 text-xs text-slate-700 scrollbar-thin">
        
        {/* ============================================================ */}
        {/* TAB 1: THEME & ACCENT PALETTES */}
        {/* ============================================================ */}
        {activeTab === 'theme' && (
          <div className="flex flex-col gap-4">
            
            {/* Canvas Lighting */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Canvas Atmosphere
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsDarkCanvas(false)}
                  className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 font-bold cursor-pointer transition-all ${
                    !isDarkCanvas ? 'bg-slate-900 text-white border-slate-900 shadow-xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span>Light Luxury</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsDarkCanvas(true)}
                  className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 font-bold cursor-pointer transition-all ${
                    isDarkCanvas ? 'bg-slate-900 text-white border-slate-900 shadow-xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Moon className="w-4 h-4 text-indigo-400" />
                  <span>Dark Obsidian</span>
                </button>
              </div>
            </div>

            {/* Curated Accent Palettes */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Primary Theme Accents
                </label>
                <span className="text-[10px] text-slate-500 font-mono">
                  {Object.keys(ACCENT_PALETTES).length} Curated Palettes
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {Object.values(ACCENT_PALETTES).map((pal) => {
                  const isSelected = pal.key === selectedAccentKey && !profile.customAccentColor;
                  return (
                    <button
                      key={pal.key}
                      onClick={() => handleSelectPalette(pal.key)}
                      className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                        isSelected
                          ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900/10 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <span
                        className="w-5 h-5 rounded-full border border-black/10 shrink-0 shadow-xs flex items-center justify-center text-white text-[10px]"
                        style={{ backgroundColor: pal.primaryHex }}
                      >
                        {isSelected && <Check className="w-3 h-3" />}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-[11px] text-slate-900 truncate">{pal.name}</div>
                        <div className="text-[10px] text-slate-400 truncate">{pal.categoryHint}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Hex Color Picker */}
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Custom Accent Color (Hex)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customHex}
                  onChange={(e) => handleCustomColorApply(e.target.value)}
                  className="w-10 h-10 rounded-xl border border-slate-200 cursor-pointer p-0.5 bg-white"
                />
                <input
                  type="text"
                  value={customHex}
                  onChange={(e) => handleCustomColorApply(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 uppercase focus:border-slate-900 focus:outline-none"
                  placeholder="#0F172A"
                />
              </div>
            </div>

            {/* Hero Cover Image presets */}
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Hero Cover Photo
              </label>
              <input
                type="url"
                value={profile.coverImageUrl}
                onChange={(e) => setProfile((prev) => ({ ...prev, coverImageUrl: e.target.value }))}
                placeholder="Paste custom cover photo URL..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-mono text-slate-700 focus:border-slate-900 focus:outline-none"
              />
            </div>

          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 2: LOCATION & SALON DETAILS */}
        {/* ============================================================ */}
        {activeTab === 'location' && (
          <div className="flex flex-col gap-4">
            
            {/* Business Name & Subdomain */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Salon Business Name
              </label>
              <input
                type="text"
                value={profile.businessName}
                onChange={(e) => setProfile((prev) => ({ ...prev, businessName: e.target.value }))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                placeholder="e.g. Miraki Hair Studio"
              />
            </div>

            {/* Quick City Dropdown */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Salon City (India)
              </label>
              <select
                value={profile.city}
                onChange={(e) => setProfile((prev) => ({ ...prev, city: e.target.value }))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {INDIAN_MAJOR_CITIES.map((c) => {
                  const cityName = c.split(',')[0];
                  return (
                    <option key={cityName} value={cityName}>
                      {c}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Full Street Address & Landmark */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Street Address & Landmark
              </label>
              <textarea
                rows={2}
                value={profile.address}
                onChange={(e) => setProfile((prev) => ({ ...prev, address: e.target.value }))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 text-slate-900 focus:border-slate-900 focus:outline-none"
                placeholder="e.g. 100 Feet Rd, Indiranagar, Opp. Metro Pillar 42"
              />
            </div>

            {/* Postal Code */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                PIN / Postal Code
              </label>
              <input
                type="text"
                value={profile.postalCode}
                onChange={(e) => setProfile((prev) => ({ ...prev, postalCode: e.target.value }))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
                placeholder="560038"
              />
            </div>

            {/* Phone & WhatsApp */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Phone (+91)
                </label>
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
                  placeholder="+91 98765 43210"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  WhatsApp
                </label>
                <input
                  type="text"
                  value={profile.whatsapp}
                  onChange={(e) => setProfile((prev) => ({ ...prev, whatsapp: e.target.value }))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            {/* Lead Founder / Owner Info */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Owner / Lead
                </label>
                <input
                  type="text"
                  value={profile.ownerName}
                  onChange={(e) => setProfile((prev) => ({ ...prev, ownerName: e.target.value }))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Owner Role
                </label>
                <input
                  type="text"
                  value={profile.ownerRole}
                  onChange={(e) => setProfile((prev) => ({ ...prev, ownerRole: e.target.value }))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            {/* Instagram Handle */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Instagram Handle
              </label>
              <div className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-300 bg-white">
                <span className="text-slate-400 font-mono">@</span>
                <input
                  type="text"
                  value={profile.instagramHandle?.replace('@', '') || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, instagramHandle: `@${e.target.value.replace('@', '')}` }))}
                  className="w-full text-xs font-mono text-slate-900 outline-none"
                  placeholder="miraki.studio"
                />
              </div>
            </div>

          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 3: SECTION VISIBILITY TOGGLES */}
        {/* ============================================================ */}
        {activeTab === 'sections' && (
          <div className="flex flex-col gap-3">
            <div className="bg-amber-50 border border-amber-200/70 p-3 rounded-xl text-[11px] text-amber-900">
              <strong>100% Real-Time Reflection:</strong> Toggle sections on or off to preview and adjust your client-facing layout.
            </div>

            <div className="flex flex-col gap-2">
              
              <div className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">Sticky Top Header</div>
                  <div className="text-[10px] text-slate-400">Branding, location & booking CTA</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSection('header')}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    sectionVisibility.header ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {sectionVisibility.header ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">Hero & Direct Booking</div>
                  <div className="text-[10px] text-slate-400">Tagline, cover, headline & INR CTA</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSection('hero')}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    sectionVisibility.hero ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {sectionVisibility.hero ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">Quick Metrics Bar</div>
                  <div className="text-[10px] text-slate-400">Starting INR rates, rating & reviews</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSection('metrics')}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    sectionVisibility.metrics ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {sectionVisibility.metrics ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">Story & Hygiene Badges</div>
                  <div className="text-[10px] text-slate-400">Founder quote & medical sterilizations</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSection('about')}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    sectionVisibility.about ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {sectionVisibility.about ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">Services & INR (₹) Menu</div>
                  <div className="text-[10px] text-slate-400">Categorized treatments & prices</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSection('services')}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    sectionVisibility.services ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {sectionVisibility.services ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">Master Stylists Roster</div>
                  <div className="text-[10px] text-slate-400">Specialist cards, ratings & skills</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSection('stylists')}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    sectionVisibility.stylists ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {sectionVisibility.stylists ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">Client Reviews & Testimonials</div>
                  <div className="text-[10px] text-slate-400">5-star reviews & verified feedback</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSection('testimonials')}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    sectionVisibility.testimonials ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {sectionVisibility.testimonials ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">Studio Lookbook Gallery</div>
                  <div className="text-[10px] text-slate-400">Makeovers & client transformation photos</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSection('gallery')}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    sectionVisibility.gallery ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {sectionVisibility.gallery ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">Location, Map & Timings</div>
                  <div className="text-[10px] text-slate-400">Map card, operating hours & directions</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSection('location')}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    sectionVisibility.location ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {sectionVisibility.location ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">Floating WhatsApp Chat</div>
                  <div className="text-[10px] text-slate-400">1-click WhatsApp booking bubble</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSection('whatsappFloat')}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    sectionVisibility.whatsappFloat ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {sectionVisibility.whatsappFloat ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>

            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 4: AI STUDIO ASSISTANT */}
        {/* ============================================================ */}
        {activeTab === 'ai' && (
          <div className="flex flex-col gap-4">
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/60 p-3.5 rounded-xl flex flex-col gap-2">
              <div className="flex items-center gap-2 text-purple-900 font-bold">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span>AI Salon Copywriter</span>
              </div>
              <p className="text-[11px] text-purple-800 leading-relaxed">
                Generate high-converting headlines, seasonal offers, and story descriptions tailored for Indian clientele.
              </p>
            </div>

            {/* Custom AI Prompt Box */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Custom AI Prompt
              </label>
              <textarea
                rows={3}
                value={aiCustomText}
                onChange={(e) => setAiCustomText(e.target.value)}
                placeholder="e.g. Write luxury organic tagline for bridal studio in Indiranagar Bengaluru..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (onAIGeneratePrompt) {
                    onAIGeneratePrompt('custom', aiCustomText);
                    setAiCustomText('');
                    showToast('AI regenerated copy applied!');
                  }
                }}
                className="mt-2 w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Generate & Apply to Canvas</span>
              </button>
            </div>

            {/* Quick AI Action Buttons */}
            <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                1-Click AI Presets
              </span>

              <button
                type="button"
                onClick={() => onAIGeneratePrompt && onAIGeneratePrompt('luxury')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white text-left flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <div className="font-bold text-slate-900">✨ Ultra-Luxury & Botanical</div>
                  <div className="text-[10px] text-slate-400">High-ticket premium salon wording</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </button>

              <button
                type="button"
                onClick={() => onAIGeneratePrompt && onAIGeneratePrompt('bridal')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white text-left flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <div className="font-bold text-slate-900">👰 Festive & Bridal Packages</div>
                  <div className="text-[10px] text-slate-400">Diwali, Wedding & Makeover headlines</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </button>

              <button
                type="button"
                onClick={() => onAIGeneratePrompt && onAIGeneratePrompt('genz')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white text-left flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <div className="font-bold text-slate-900">⚡ Modern Trendsetter Tone</div>
                  <div className="text-[10px] text-slate-400">Punchy, bold styling & color studio</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </button>

              <button
                type="button"
                onClick={() => onAIGeneratePrompt && onAIGeneratePrompt('ayurvedic')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white text-left flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <div className="font-bold text-slate-900">🌿 Holistic Ayurvedic Glow</div>
                  <div className="text-[10px] text-slate-400">Herbal, wellness & scalp healing copy</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>

          </div>
        )}

      </div>
    </aside>
  );
};
