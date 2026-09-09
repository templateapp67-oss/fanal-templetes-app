import React, { useRef, useState } from 'react';
import {
  Save,
  Eye,
  ExternalLink,
  Copy,
  Check,
  MapPin,
  Phone,
  Mail,
  MessageSquare,
  Clock,
  Scissors,
  Plus,
  Trash2,
  Globe,
  Loader2,
  Store,
  UserRound,
  Building2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Sparkles,
  RotateCcw,
  Instagram,
  Facebook,
  Share2,
} from 'lucide-react';
import { SalonProfile, SalonService, BusinessTypeId } from '../types';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';
import { slugifySalonName } from '../lib/salonStore';
import { SaveStatus, getSaveUiState } from '../lib/autoSave';
import { AIBioModal } from './AIBioModal';
import { WebsiteSavedModal } from './WebsiteSavedModal';
import { GuestModeBanner } from './GuestModeBanner';
import { TikTokIcon } from './TikTokIcon';
import { formatInstagramUrl, formatFacebookUrl, formatTikTokUrl, displaySocialHandle } from '../utils/social';
import { geocodeAddressWithGoogleMaps } from '../utils/googleGeocoding';
import { GooglePlacesAutocompleteInput } from './GooglePlacesAutocompleteInput';
import { GoogleMapsView } from './GoogleMapsView';

interface WebsiteEditorProps {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services: SalonService[];
  setServices: React.Dispatch<React.SetStateAction<SalonService[]>>;
  saveStatus: SaveStatus;
  /** Timestamp of the last successful (auto or manual) save. */
  lastSavedAt?: number | null;
  onComplete: () => void;
  onSelectTemplate?: (catId: BusinessTypeId) => void;
  selectedTemplateId?: BusinessTypeId;
  siteUrl: string;
  onSave: () => Promise<boolean>;
  onBackToDashboard: () => void;
  showToast?: (message: string, type?: 'success' | 'error') => void;
  isAuthenticated?: boolean;
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
}

const CATEGORY_OPTIONS = Object.values(CATEGORY_TEMPLATES);

export const WebsiteEditor: React.FC<WebsiteEditorProps> = ({
  profile,
  setProfile,
  services,
  setServices,
  saveStatus,
  lastSavedAt,
  onComplete,
  onSelectTemplate,
  selectedTemplateId,
  siteUrl,
  onSave,
  onBackToDashboard,
  showToast,
  isAuthenticated = true,
  onRequireAuth,
}) => {
  const [copied, setCopied] = useState(false);
  const [isBioModalOpen, setIsBioModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSiteUrl, setSavedSiteUrl] = useState<string | null>(null);
  const saveTriggerRef = useRef<HTMLButtonElement | null>(null);
  // 'pending' = edits are debounced and will save in ~1.2s; 'saving' = the
  // save request is in flight. Both show as "Saving…".
  const saveUi = getSaveUiState(saveStatus, { busyOverride: isSaving, lastSavedAt });
  const isSavePending = saveUi.busy;
  const isSaveFailed = saveUi.failed;

  const upd = (patch: Partial<SalonProfile>) =>
    setProfile((prev) => ({ ...prev, ...patch }));

  // Automatically geocode address with Google Maps API when profile.address updates
  React.useEffect(() => {
    if (!profile.address || profile.address.trim().length < 5) return;

    const timer = setTimeout(async () => {
      const result = await geocodeAddressWithGoogleMaps(profile.address);
      if (result) {
        setProfile((prev) => {
          // Avoid triggering unnecessary re-renders if coordinates haven't changed significantly
          if (
            Math.abs((prev.latitude || 0) - result.lat) < 0.0001 &&
            Math.abs((prev.longitude || 0) - result.lng) < 0.0001
          ) {
            return prev;
          }
          return {
            ...prev,
            latitude: result.lat,
            longitude: result.lng,
          };
        });
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [profile.address, setProfile]);

  // -- Services ------------------------------------------------
  const addService = () => {
    const srv: SalonService = {
      id: `srv-${Date.now()}`,
      name: 'New Service',
      category: CATEGORY_TEMPLATES[selectedTemplateId || profile.businessType]?.subCategories?.[0] || 'General',
      durationMinutes: 45,
      price: 500,
      description: 'Description coming soon.',
      icon: 'sparkles',
      popular: false,
    };
    setServices((prev) => [...prev, srv]);
    showToast?.('New service added to your menu.');
  };

  const updateService = (id: string, patch: Partial<SalonService>) =>
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeService = (id: string) => {
    setServices((prev) => prev.filter((s) => s.id !== id));
    showToast?.('Service removed.');
  };

  const handleTemplateChange = (catId: BusinessTypeId) => {
    onSelectTemplate?.(catId);
  };

  const handleCopyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(siteUrl);
      setCopied(true);
      showToast?.('Website link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      showToast?.('Couldn’t copy the link. Please copy the displayed site URL manually.', 'error');
    }
  };

  const handleSave = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isSavePending) return;
    saveTriggerRef.current = event.currentTarget;
    setIsSaving(true);
    try {
      // Only an explicit, successful save opens the next-step dialog, never an autosave.
      // persistSalonState resolves false (never throws) when a save fails, so a
      // thrown error here means an unexpected programming error — log it fully.
      if (await onSave()) setSavedSiteUrl(siteUrl);
    } catch (err) {
      console.error('[WebsiteEditor] Unexpected error during manual save:', err);
      showToast?.('Save failed. Please try again.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const subCategories =
    CATEGORY_TEMPLATES[selectedTemplateId || profile.businessType]?.subCategories || [];

  const saveLabel = saveUi.label;

  return (
    <div className="min-h-screen pt-24 pb-16 bg-[#f6f7fb] text-[#151c27]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col gap-6">

        {/* ===== Top sticky save bar ===== */}
        <div className="sticky top-20 z-30 bg-white/95 backdrop-blur-md border border-gray-200 rounded-2xl shadow-sm px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-[#C20E5A]/10 text-[#C20E5A] flex items-center justify-center shrink-0">
              <Store className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold leading-tight truncate">
                Website Editor
              </h1>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 font-medium">
                <span className="font-mono text-[#C20E5A] font-bold">
                  {CATEGORY_TEMPLATES[selectedTemplateId || profile.businessType]?.title || 'Salon'}
                </span>
                <span className="text-gray-300">•</span>
                <span className="truncate">{siteUrl}</span>
              </div>
            </div>
          </div>

          {/* Save status pill */}
          <div className="flex items-center gap-2">
            <div
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                isSavePending
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : isSaveFailed
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : saveStatus === 'saved' || saveStatus === 'saved_local'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              {isSavePending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isSaveFailed ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>{saveLabel}</span>
            </div>

            {/* Retry after a failed auto-save */}
            {isSaveFailed && (
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[11px] font-bold transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry Save</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={isSavePending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#C20E5A] hover:bg-[#A30B4A] disabled:opacity-60 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
            >
              {isSavePending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{isSavePending ? 'Saving…' : 'Save & Update Website'}</span>
            </button>

            <button
              type="button"
              onClick={onComplete}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
            >
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">Live Preview</span>
            </button>
          </div>
        </div>

        {/* ===== 1. SALON DETAILS ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <Store className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Salon Details</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            This is the identity shown on your live website header, hero and about section.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Salon/Studio Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={profile.businessName}
                onChange={(e) =>
                  upd({ businessName: e.target.value, subdomain: slugifySalonName(e.target.value) || profile.subdomain })
                }
                placeholder="e.g. Miraki Hair Studio"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold font-mono-caps text-gray-700">
                  Tagline / Catchphrase
                </label>
                <button
                  type="button"
                  onClick={() => setIsBioModalOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#C20E5A] hover:text-[#A30B4A] hover:underline cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Generate with AI / Voice</span>
                </button>
              </div>
              <input
                type="text"
                value={profile.tagline}
                onChange={(e) => upd({ tagline: e.target.value })}
                placeholder="e.g. Redefining luxury salon care"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold font-mono-caps text-gray-700">
                  About / Story
                </label>
                <button
                  type="button"
                  onClick={() => setIsBioModalOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#C20E5A] hover:text-[#A30B4A] hover:underline cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Generate with AI / Voice</span>
                </button>
              </div>
              <textarea
                rows={3}
                value={profile.about}
                onChange={(e) => upd({ about: e.target.value })}
                placeholder="Tell clients about your salon's vision, philosophy and experience..."
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Owner / Founder Name
              </label>
              <input
                type="text"
                value={profile.ownerName}
                onChange={(e) => upd({ ownerName: e.target.value })}
                placeholder="e.g. Priya Sharma"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>
          </div>
        </section>

        {/* ===== 2. CONTACT & LOCATION ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <UserRound className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Contact &amp; Location</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            How customers reach, call, WhatsApp or find your physical salon.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Phone Number <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-gray-400 shrink-0 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) => upd({ phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                WhatsApp Number
              </label>
              <div className="relative">
                <MessageSquare className="w-4 h-4 text-gray-400 shrink-0 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={profile.whatsapp}
                  onChange={(e) => upd({ whatsapp: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-gray-400 shrink-0 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  value={profile.email}
                  onChange={(e) => upd({ email: e.target.value })}
                  placeholder="hello@miraki.com"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div className="md:col-span-2 space-y-4">
              <GooglePlacesAutocompleteInput
                value={profile.address}
                onChange={(val) => upd({ address: val })}
                latitude={profile.latitude}
                longitude={profile.longitude}
                label="Physical Address / Location (Google Places Autocomplete API)"
                onAddressSelected={(selectedAddr, lat, lng, comps) => {
                  upd({
                    address: selectedAddr,
                    latitude: lat,
                    longitude: lng,
                    city: comps?.city || profile.city,
                    postalCode: comps?.pincode || profile.postalCode,
                  });
                }}
                onCoordinatesUpdate={(lat, lng) => {
                  upd({ latitude: lat, longitude: lng });
                }}
              />

              {profile.latitude && profile.longitude ? (
                <div className="space-y-1.5 mt-2 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                      Live Location Map Preview
                    </label>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-md">
                      GPS: {profile.latitude.toFixed(6)}, {profile.longitude.toFixed(6)}
                    </span>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-slate-200 shadow-xs">
                    <GoogleMapsView
                      latitude={profile.latitude}
                      longitude={profile.longitude}
                      title={profile.businessName || 'Your Salon'}
                      address={profile.address || ''}
                      phone={profile.phone || ''}
                      height="180px"
                      zoom={15}
                      interactive={true}
                      onPositionChange={(lat, lng) => {
                        upd({ latitude: lat, longitude: lng });
                      }}
                      accentColor={profile.brandColor || '#C20E5A'}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium italic mt-1 text-center">
                    "Pin updates automatically. Drag the marker pin on the map to fine-tune your exact coordinates."
                  </p>
                </div>
              ) : null}
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                City / Area
              </label>
              <input
                type="text"
                value={profile.city}
                onChange={(e) => upd({ city: e.target.value })}
                placeholder="e.g. Hyderabad, Telangana"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>
          </div>
        </section>

        {/* ===== 3. SOCIAL MEDIA (INSTAGRAM, FACEBOOK, TIKTOK) ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6" id="website-editor-social-media-section">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-[#C20E5A]" />
              <h2 className="font-display font-bold text-base">Social Media</h2>
            </div>
            <span className="bg-pink-50 text-pink-700 border border-pink-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full">
              Website Header
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Links for Instagram, Facebook, and TikTok will appear directly in your website header so visitors can follow and discover your portfolio.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Instagram */}
            <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-pink-300 transition-all">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold font-mono-caps text-gray-700 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white flex items-center justify-center text-[10px]">
                    <Instagram className="w-3 h-3" />
                  </span>
                  <span>Instagram</span>
                </label>
                {profile.instagramHandle && (
                  <a
                    href={formatInstagramUrl(profile.instagramHandle)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-pink-600 hover:text-pink-800 hover:underline flex items-center gap-0.5"
                  >
                    <span>Test</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
              <input
                type="text"
                value={profile.instagramHandle || ''}
                onChange={(e) => upd({ instagramHandle: e.target.value })}
                placeholder="e.g. @arts_by_uma or url"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-xs font-mono bg-white focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
              <div className="text-[10px] text-gray-400 mt-1">
                {profile.instagramHandle ? displaySocialHandle(profile.instagramHandle) : 'Add handle or URL'}
              </div>
            </div>

            {/* Facebook */}
            <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-blue-300 transition-all">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold font-mono-caps text-gray-700 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded bg-blue-600 text-white flex items-center justify-center text-[10px]">
                    <Facebook className="w-3 h-3" />
                  </span>
                  <span>Facebook</span>
                </label>
                {profile.facebookPage && (
                  <a
                    href={formatFacebookUrl(profile.facebookPage)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-0.5"
                  >
                    <span>Test</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
              <input
                type="text"
                value={profile.facebookPage || ''}
                onChange={(e) => upd({ facebookPage: e.target.value })}
                placeholder="e.g. https://facebook.com/salon"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-xs font-mono bg-white focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
              <div className="text-[10px] text-gray-400 mt-1">
                {profile.facebookPage ? displaySocialHandle(profile.facebookPage, '') : 'Add page URL'}
              </div>
            </div>

            {/* TikTok */}
            <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-slate-800 transition-all">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold font-mono-caps text-gray-700 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded bg-slate-900 text-cyan-300 flex items-center justify-center text-[10px]">
                    <TikTokIcon className="w-3 h-3" />
                  </span>
                  <span>TikTok</span>
                </label>
                {(profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl) && (
                  <a
                    href={formatTikTokUrl(profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-slate-900 hover:text-cyan-600 hover:underline flex items-center gap-0.5"
                  >
                    <span>Test</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
              <input
                type="text"
                value={profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  upd({
                    tiktokProfile: val,
                    tiktokHandle: val,
                    tiktokUrl: val,
                  });
                }}
                placeholder="e.g. @artsbyuma or url"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-xs font-mono bg-white focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
              <div className="text-[10px] text-gray-400 mt-1">
                {(profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl)
                  ? displaySocialHandle(profile.tiktokProfile || profile.tiktokHandle || profile.tiktokUrl)
                  : 'Add handle or URL'}
              </div>
            </div>
          </div>
        </section>

        {/* ===== 4. SERVICES & PRICING ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-[#C20E5A]" />
              <h2 className="font-display font-bold text-base">Services &amp; Pricing</h2>
            </div>
            <button
              type="button"
              onClick={addService}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#C20E5A]/10 hover:bg-[#C20E5A]/20 text-[#C20E5A] text-xs font-bold transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Service</span>
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Add or edit the treatments your customers can book online with prices in ₹.
          </p>

          <div className="space-y-3">
            {services.map((srv, idx) => (
              <div
                key={srv.id}
                className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-[#C20E5A]/30 transition-all flex flex-col md:flex-row md:items-center gap-3"
              >
                <div className="w-6 text-center text-xs font-mono font-bold text-gray-400">
                  {idx + 1}
                </div>

                <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-mono-caps text-gray-500 block mb-0.5">
                      Service Name
                    </label>
                    <input
                      type="text"
                      value={srv.name}
                      onChange={(e) => updateService(srv.id, { name: e.target.value })}
                      placeholder="e.g. Signature Haircut & Styling"
                      className="w-full p-2 rounded-lg border border-gray-300 text-xs bg-white focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-mono-caps text-gray-500 block mb-0.5">
                      Category
                    </label>
                    <select
                      value={srv.category}
                      onChange={(e) => updateService(srv.id, { category: e.target.value })}
                      className="w-full p-2 rounded-lg border border-gray-300 text-xs bg-white focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                    >
                      {subCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-mono-caps text-gray-500 block mb-0.5">
                        Price (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={srv.price}
                        onChange={(e) =>
                          updateService(srv.id, { price: Number(e.target.value) || 0 })
                        }
                        className="w-full p-2 rounded-lg border border-gray-300 text-xs bg-white font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono-caps text-gray-500 block mb-0.5">
                        Mins
                      </label>
                      <input
                        type="number"
                        min={5}
                        step={5}
                        value={srv.durationMinutes}
                        onChange={(e) =>
                          updateService(srv.id, {
                            durationMinutes: Number(e.target.value) || 15,
                          })
                        }
                        className="w-full p-2 rounded-lg border border-gray-300 text-xs bg-white font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeService(srv.id)}
                  className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors self-end md:self-center cursor-pointer"
                  title="Delete service"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ===== 4. WORKING HOURS / TIMINGS ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Timings</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Displayed on your website header and footer so clients know when you’re open.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Mon – Fri
              </label>
              <input
                type="text"
                value={profile.workingHoursMonFri || ''}
                onChange={(e) => upd({ workingHoursMonFri: e.target.value })}
                placeholder="10:00 AM - 08:30 PM"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Saturday
              </label>
              <input
                type="text"
                value={profile.workingHoursSat || ''}
                onChange={(e) => upd({ workingHoursSat: e.target.value })}
                placeholder="09:00 AM - 09:00 PM"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Sunday
              </label>
              <input
                type="text"
                value={profile.workingHoursSun || ''}
                onChange={(e) => upd({ workingHoursSun: e.target.value })}
                placeholder="Closed / By appointment"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>
          </div>
        </section>

        {/* ===== 5. TEMPLATE & LIVE SITE ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Template &amp; Live Website</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Pick a template (your data is preserved) and grab your white-label link.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Active Template
              </label>
              <select
                value={selectedTemplateId || profile.businessType}
                onChange={(e) => handleTemplateChange(e.target.value as BusinessTypeId)}
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              >
                {CATEGORY_OPTIONS.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>
                    {tmpl.title} ({tmpl.paletteLabel.split('(')[0]})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-gray-500 mt-1">
                Switching keeps your salon details, services &amp; pricing.
              </p>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Sub-domain (white-label)
              </label>
              <div className="flex items-center">
                <input
                  type="text"
                  value={profile.subdomain}
                  onChange={(e) =>
                    upd({
                      subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                    })
                  }
                  placeholder="mysalon"
                  className="flex-1 p-2.5 rounded-l-xl border border-gray-300 border-r-0 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
                <span className="bg-gray-50 px-3 py-2.5 border border-gray-300 rounded-r-xl text-sm font-mono text-gray-500">
                  .nexora.in
                </span>
              </div>
            </div>

            <div className="md:col-span-2 rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <Globe className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-mono text-sm font-bold text-emerald-900 truncate">
                  {siteUrl}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-800 text-[11px] font-bold hover:bg-emerald-50 transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy Link'}</span>
                </button>
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Site</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ===== BOTTOM SAVE BAR ===== */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            {isSaveFailed ? (
              <AlertCircle className="w-4 h-4 text-rose-500" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            )}
            <span>
              {isSavePending
                ? 'Auto-saving your changes…'
                : isSaveFailed
                ? 'We couldn’t save your changes. Check your connection and retry — the exact error is in the browser console.'
                : saveStatus === 'saved_local'
                ? 'Your changes are saved on this device as a local draft. Cloud sync is unavailable right now — we’ll retry automatically and the exact error is in the browser console.'
                : 'Every edit auto-saves within seconds. Save to publish & update your website, share its link, or return to your dashboard.'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSavePending}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#C20E5A] hover:bg-[#A30B4A] disabled:opacity-60 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            {isSavePending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>{isSavePending ? 'Saving…' : 'Save & Update Website'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Count of fields for transparency (dedup guard) */}
        <p className="text-center text-[10px] text-gray-400 font-mono">
          One form • Each field asked once • Auto-saves ~1s after your last edit
        </p>
      </div>

      {savedSiteUrl && (
        <WebsiteSavedModal
          siteUrl={savedSiteUrl}
          returnFocusTo={saveTriggerRef.current}
          onClose={() => setSavedSiteUrl(null)}
          onBackToDashboard={() => {
            setSavedSiteUrl(null);
            onBackToDashboard();
          }}
        />
      )}

      <AIBioModal
        isOpen={isBioModalOpen}
        onClose={() => setIsBioModalOpen(false)}
        businessName={profile.businessName}
        businessType={profile.businessType}
        ownerName={profile.ownerName}
        onApply={(bio, tagline) => {
          upd({ about: bio, tagline });
          showToast?.('AI Bio & Tagline generated and applied!');
        }}
      />
    </div>
  );
};
