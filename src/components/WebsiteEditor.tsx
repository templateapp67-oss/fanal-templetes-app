import { readPartnerProfile } from '../lib/readPartnerProfile';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import { isPartnerProfileComplete } from '../lib/profileCompletion';
import { PartnerProfileModal } from './PartnerProfileModal';
import { copyToClipboard } from '../lib/clipboard';
import React, { useRef, useState } from 'react';
import {
  Save,
  Eye,
  ExternalLink,
  Copy,
  Check,
  Phone,
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
  Mail,
  MapPin,
  MessageSquare,
  Hash,
  Settings,
  Type,
} from 'lucide-react';
import { CURATED_GOOGLE_FONTS } from '../utils/fontHelper';
import { SalonProfile, SalonService, BusinessTypeId } from '../types';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';
import { slugifySalonName } from '../lib/salonStore';
import { SaveStatus, getSaveUiState } from '../lib/autoSave';
import { AIBioModal } from './AIBioModal';
import { SavePermissionNotice } from './SavePermissionNotice';
import { WebsiteSavedModal } from './WebsiteSavedModal';
import { isCompletionNotReadyError, recordTemplateCompletion } from '../lib/growthPartner';
import { TikTokIcon } from './TikTokIcon';
import { formatInstagramUrl, formatFacebookUrl, formatTikTokUrl, displaySocialHandle } from '../utils/social';
import { geocodeAddressWithGoogleMaps } from '../utils/googleGeocoding';
import { GooglePlacesAutocompleteInput } from './GooglePlacesAutocompleteInput';
import { GoogleMapsView } from './GoogleMapsView';
import { generateFaviconDataUrls } from '../lib/useSalonFavicon';
import { generateSocialSharePlaceholder } from '../utils/socialShareGenerator';
import { Upload, Image as ImageIcon } from 'lucide-react';
import { compressAndResizeImage } from '../utils/imageUploadHelper';

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
  /**
   * True when the last cloud save was rejected because the Supabase session is
   * no longer usable (expired/revoked token) even after the save engine
   * refreshed and retried once. Renders the in-editor "sign in again" notice —
   * the owner's edits are already safe in the local draft.
   */
  sessionExpired?: boolean;
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
  sessionExpired = false,
}) => {
  const [contactDetailsOpen, setContactDetailsOpen] = useState(false);
  const [profileCompletion, setProfileCompletion] = useState<'loading' | 'complete' | 'incomplete' | 'error'>('loading');
  const [completionRetry, setCompletionRetry] = useState(0);
  const [isSyncingProfile, setIsSyncingProfile] = useState(false);

  // Auto-fill "Contact & Location" fields from User Profile data (profiles table / readPartnerProfile)
  const loadProfileContactDetails = React.useCallback(async (forceSync = false) => {
    try {
      setIsSyncingProfile(true);
      let profileData: any = null;
      let authUser: any = null;

      if (!isMockSupabase) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          authUser = user;
          if (user?.id) {
            const res = await readPartnerProfile(user.id);
            if (res?.data) {
              profileData = res.data;
            }
          }
        } catch {
          // Fallback direct query if readPartnerProfile errors
          const { data: { user } } = await supabase.auth.getUser();
          authUser = user;
          if (user?.id) {
            const { data } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', user.id)
              .maybeSingle();
            if (data) profileData = data;
          }
        }
      }

      setProfile((prev) => {
        const phoneVal = profileData?.phone_number || profileData?.phone || '';
        const whatsappVal = profileData?.whatsapp || profileData?.whatsapp_number || '';
        const emailVal = profileData?.email || authUser?.email || '';
        const addressVal = profileData?.full_address || profileData?.address || '';
        const cityVal = profileData?.city || '';
        const postalCodeVal = profileData?.postal_code || profileData?.pincode || profileData?.postalCode || '';
        const areaLocalityVal = profileData?.area_locality || profileData?.areaLocality || profileData?.landmark || '';

        return {
          ...prev,
          phone: forceSync ? (phoneVal || prev.phone || '') : (prev.phone || phoneVal || ''),
          whatsapp: forceSync ? (whatsappVal || prev.whatsapp || '') : (prev.whatsapp || whatsappVal || ''),
          email: forceSync ? (emailVal || prev.email || '') : (prev.email || emailVal || ''),
          address: forceSync ? (addressVal || prev.address || '') : (prev.address || addressVal || ''),
          city: forceSync ? (cityVal || prev.city || '') : (prev.city || cityVal || ''),
          postalCode: forceSync ? (postalCodeVal || prev.postalCode || '') : (prev.postalCode || postalCodeVal || ''),
          areaLocality: forceSync ? (areaLocalityVal || prev.areaLocality || '') : (prev.areaLocality || areaLocalityVal || ''),
        };
      });
    } catch (err) {
      console.warn('[WebsiteEditor] Contact details auto-fill notice:', err);
    } finally {
      setIsSyncingProfile(false);
    }
  }, [setProfile]);

  React.useEffect(() => {
    loadProfileContactDetails(false);
  }, [loadProfileContactDetails]);

  React.useEffect(() => {
    let active = true;
    setProfileCompletion('loading');
    if (isMockSupabase || !profile.ownerId) {
      const isCompleteLocally = !!(
        profile.ownerName?.trim() &&
        profile.whatsapp?.trim() &&
        profile.postalCode?.trim() &&
        profile.city?.trim() &&
        profile.areaLocality?.trim() &&
        profile.ownerPhotoUrl?.trim() &&
        profile.dob?.trim()
      );
      setProfileCompletion(isCompleteLocally ? 'complete' : 'incomplete');
      return;
    }
    readPartnerProfile(profile.ownerId).then(({ data, error }) => {
      if (active) setProfileCompletion(error ? 'error' : isPartnerProfileComplete(data) ? 'complete' : 'incomplete');
    }).catch(() => { if (active) setProfileCompletion('error'); });
    return () => { active = false; };
  }, [profile.ownerId, profile.dob, profile.ownerPhotoUrl, completionRetry]);
  const [copied, setCopied] = useState(false);
  const [isBioModalOpen, setIsBioModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [brandFocus, setBrandFocus] = useState('');
  const [brandAdvice, setBrandAdvice] = useState('');
  const [isBrandThinking, setIsBrandThinking] = useState(false);
  const [scentProfile, setScentProfile] = useState('Jasmine & White Tea');
  const [soundscape, setSoundscape] = useState('Lounge & Acoustic Chill');
  const [consultationStyle, setConsultationStyle] = useState('Warm & Personalised');
  const [savedSiteUrl, setSavedSiteUrl] = useState<string | null>(null);
  // Phase 5: set ONLY when the verified completion RPC rejects as not-ready
  // after a successful cloud save. Never set optimistically, never blocks save.
  const [completionNote, setCompletionNote] = useState<string | null>(null);
  const saveTriggerRef = useRef<HTMLButtonElement | null>(null);
  const socialShareInputRef = useRef<HTMLInputElement | null>(null);
  const faviconUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [faviconMode, setFaviconMode] = useState<'letter' | 'custom'>(profile.customFaviconUrl ? 'custom' : 'letter');

  React.useEffect(() => {
    if (profile.customFaviconUrl) {
      setFaviconMode('custom');
    }
  }, [profile.customFaviconUrl]);

  const handleFaviconUploadFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await compressAndResizeImage(file, 256, 2 * 1024 * 1024);
      if (result.isValid && result.dataUrl) {
        upd({ customFaviconUrl: result.dataUrl });
        if (showToast) showToast('Custom favicon image uploaded successfully!', 'success');
      } else {
        if (showToast) showToast(result.errorMessage || 'Failed to compress favicon image.', 'error');
      }
    } catch (err: any) {
      if (showToast) showToast('Error processing custom favicon image.', 'error');
    }
  };

  const handleSocialShareFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await compressAndResizeImage(file, 1200, 2 * 1024 * 1024);
      if (result.isValid && result.dataUrl) {
        upd({ socialShareImageUrl: result.dataUrl });
        if (showToast) showToast('Social share image updated!', 'success');
      } else {
        if (showToast) showToast(result.errorMessage || 'Failed to compress social image.', 'error');
      }
    } catch (err: any) {
      if (showToast) showToast('Error processing social share image.', 'error');
    }
  };
  // 'pending' = edits are debounced and will save in ~1.2s; 'saving' = the
  // save request is in flight. Both show as "Saving…".
  const saveUi = getSaveUiState(saveStatus, { busyOverride: isSaving, lastSavedAt });
  const isSavePending = saveUi.busy;
  const isSaveFailed = saveUi.failed;

  const upd = (patch: Partial<SalonProfile>) => {
    const merged = { ...patch };
    if ('phone' in patch) {
      (merged as any).phone_number = patch.phone;
    } else if ('phone_number' in patch) {
      merged.phone = (patch as any).phone_number;
    }
    if ('whatsapp' in patch) {
      (merged as any).whatsapp_number = patch.whatsapp;
    } else if ('whatsapp_number' in patch) {
      merged.whatsapp = (patch as any).whatsapp_number;
    }
    setProfile((prev) => ({ ...prev, ...merged }));
  };

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
    const ok = await copyToClipboard(siteUrl);
    if (ok) {
      setCopied(true);
      showToast?.('Website link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopied(false);
      showToast?.('Couldn’t copy the link. Please copy the displayed site URL manually.', 'error');
    }
  };

  const handleSave = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (isSavePending) return;
    // The button handlers pass their event (so focus can be returned to the
    // trigger from the success dialog); the session notice's "Retry Save"
    // calls this with no event and keeps the previous trigger.
    if (event?.currentTarget) saveTriggerRef.current = event.currentTarget;
    setIsSaving(true);
    try {
      // Only an explicit, successful save opens the next-step dialog, never an autosave.
      // persistSalonState resolves false (never throws) when a save fails, so a
      // thrown error here means an unexpected programming error — log it fully.
      if (await onSave()) {
        setSavedSiteUrl(siteUrl);
        // Phase 5: verified onboarding completion. The RPC derives the user
        // from the session, verifies the finished-website conditions
        // server-side, and advances the funnel row (idempotent — safe after
        // every cloud save, including retries). Best-effort: the save already
        // succeeded, so only a not-ready verdict surfaces a note in the
        // success dialog; anything else is logged, never shown as an error.
        setCompletionNote(null);
        recordTemplateCompletion().catch((completionError: unknown) => {
          if (isCompletionNotReadyError(completionError)) {
            setCompletionNote('Your website setup is not complete yet.');
          } else {
            console.error('[WebsiteEditor] Template completion update failed:', completionError);
          }
        });
      }
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
    <div className="min-h-screen w-full max-w-full overflow-x-clip pt-24 pb-16 bg-[#f6f7fb] text-[#151c27]">
      <div className="w-full max-w-full sm:max-w-5xl mx-auto px-4 md:px-6 flex flex-col gap-6 min-w-0">

        {/* Session expired / permission-safe notice. Shown only when the save
            engine decided the cloud session must be re-established; the local
            draft already holds every edit, so nothing is lost. */}
        <SavePermissionNotice
          visible={sessionExpired}
          onSignIn={onRequireAuth ? () => onRequireAuth('login') : undefined}
          onRetry={() => {
            void handleSave();
          }}
        />

        {/* ===== Top sticky save bar ===== */}
        <div className="sticky top-20 z-30 w-full min-w-0 bg-white/95 backdrop-blur-md border border-gray-200 rounded-2xl shadow-sm px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
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

          {/* Save status pill + actions. `flex-wrap` lets the buttons drop to
              the next line instead of being squeezed off a phone screen. */}
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
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
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-6">
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
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <UserRound className="w-4 h-4 text-[#C20E5A]" />
              <h2 className="font-display font-bold text-base">Contact &amp; Location</h2>
            </div>

            <div className="flex items-center flex-wrap gap-2 text-xs">
              {profileCompletion === 'incomplete' && (
                <button
                  type="button"
                  onClick={() => setContactDetailsOpen(true)}
                  className="inline-flex items-center gap-1 font-semibold text-pink-700 bg-pink-50 hover:bg-pink-100 px-2.5 py-1 rounded-full border border-pink-200 transition-colors cursor-pointer"
                >
                  <span>Complete profile · DOB &amp; photo upload</span>
                </button>
              )}
              {profileCompletion === 'complete' && (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Profile saved</span>
                </span>
              )}
              {profileCompletion === 'loading' && (
                <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-200">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Loading profile…</span>
                </span>
              )}
              {profileCompletion === 'error' && (
                <button
                  type="button"
                  onClick={() => setCompletionRetry((v) => v + 1)}
                  className="text-rose-700 hover:underline"
                >
                  Retry load
                </button>
              )}

              <button
                type="button"
                onClick={async () => {
                  await loadProfileContactDetails(true);
                  if (showToast) showToast('Contact & Location synced from User Profile!', 'success');
                }}
                disabled={isSyncingProfile}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                title="Auto-fill Contact & Location from User Profile settings"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isSyncingProfile ? 'animate-spin' : ''}`} />
                <span>Sync from Profile Settings</span>
              </button>

              <button
                type="button"
                onClick={() => setContactDetailsOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-pink-50 hover:bg-pink-100 text-[#C20E5A] text-xs font-bold transition-colors cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Profile Settings</span>
              </button>
            </div>
            {contactDetailsOpen && (
              <PartnerProfileModal
                editable
                profile={profile}
                onSaved={(patch) => {
                  upd(patch);
                  setProfileCompletion('complete');
                  if (showToast) showToast('Profile details updated!');
                }}
                onClose={() => setContactDetailsOpen(false)}
              />
            )}
          </div>

          <p className="text-[11px] text-gray-500 mb-5">
            How customers reach, call, WhatsApp or find your physical salon. Auto-filled from your profile data or editable below.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Phone Number
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="tel"
                  value={profile.phone || (profile as any).phone_number || ''}
                  onChange={(e) => upd({ phone: e.target.value })}
                  placeholder="e.g. +91 98765 43210"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                WhatsApp Number
              </label>
              <div className="relative">
                <MessageSquare className="w-4 h-4 text-emerald-500 absolute left-3 top-3" />
                <input
                  type="tel"
                  value={profile.whatsapp || (profile as any).whatsapp_number || ''}
                  onChange={(e) => upd({ whatsapp: e.target.value })}
                  placeholder="e.g. +91 98765 43210"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Contact Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="email"
                  value={profile.email || ''}
                  onChange={(e) => upd({ email: e.target.value })}
                  placeholder="e.g. contact@mysalon.com"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                City / Location
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={profile.city || ''}
                  onChange={(e) => upd({ city: e.target.value })}
                  placeholder="e.g. Mumbai, Maharashtra"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                PIN Code / Postal Code
              </label>
              <div className="relative">
                <Hash className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={profile.postalCode || ''}
                  onChange={(e) => upd({ postalCode: e.target.value })}
                  placeholder="e.g. 400001"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Area / Locality
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={profile.areaLocality || ''}
                  onChange={(e) => upd({ areaLocality: e.target.value })}
                  placeholder="e.g. Bandra West"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div className="md:col-span-2 space-y-4 pt-1">
              <GooglePlacesAutocompleteInput
                value={profile.address || ''}
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
                    state: comps?.state || profile.state,
                    areaLocality: comps?.area || profile.areaLocality,
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
                      interactive={false}
                      onPositionChange={undefined} // Location is set by address autocomplete only
                      accentColor={profile.brandColor || '#C20E5A'}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* ===== FAVICON & BRANDING ASSETS GENERATOR ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-6" id="website-editor-favicon-generator-section">
          <div className="flex items-center gap-2 mb-1">
            <Settings className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Favicon &amp; Brand Assets Generator</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Create high-fidelity tab favicons and mobile touch icons customized with your brand style.
          </p>

          {/* Generator Interface */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left side: Controls */}
            <div className="lg:col-span-5 space-y-4">
              {/* Segmented Control Mode Selector */}
              <div className="flex p-1 bg-gray-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setFaviconMode('letter')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 text-center ${
                    faviconMode === 'letter'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Letter Favicon
                </button>
                <button
                  type="button"
                  onClick={() => setFaviconMode('custom')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 text-center ${
                    faviconMode === 'custom'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Custom Favicon Image
                </button>
              </div>

              {faviconMode === 'letter' ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                      Favicon Letter
                    </label>
                    <input
                      type="text"
                      maxLength={1}
                      value={profile.faviconLetter || profile.businessName?.trim().substring(0, 1) || 'N'}
                      onChange={(e) => {
                        const char = e.target.value.toUpperCase().trim();
                        upd({ faviconLetter: char || ' ' });
                      }}
                      className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none font-bold text-center text-lg"
                      placeholder="e.g. B"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Single upper-case character (defaults to your salon name's first letter).</p>
                  </div>

                  <div>
                    <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                      Brand Theme Color
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={profile.faviconColor || profile.customAccentColor || '#C20E5A'}
                        onChange={(e) => upd({ faviconColor: e.target.value })}
                        className="w-12 h-12 rounded-xl border border-gray-300 cursor-pointer overflow-hidden shrink-0"
                      />
                      <input
                        type="text"
                        value={profile.faviconColor || profile.customAccentColor || '#C20E5A'}
                        onChange={(e) => {
                          if (/^#[0-9A-F]{6}$/i.test(e.target.value) || e.target.value === '') {
                            upd({ faviconColor: e.target.value });
                          }
                        }}
                        placeholder="#C20E5A"
                        className="flex-1 p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none font-mono text-center"
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">Uses your brand color or select a custom background color for the favicon.</p>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        // Reset to brand defaults
                        upd({
                          faviconLetter: profile.businessName?.trim().substring(0, 1) || 'N',
                          faviconColor: profile.customAccentColor || '#C20E5A',
                        });
                        if (showToast) showToast('Reset to brand defaults!');
                      }}
                      className="w-full py-2 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-bold transition-colors cursor-pointer text-center"
                    >
                      Reset to Brand Defaults
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Upload Custom Favicon Box */}
                  <div>
                    <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                      Upload Favicon Image
                    </label>
                    <div 
                      onClick={() => faviconUploadInputRef.current?.click()}
                      className="border-2 border-dashed border-gray-200 hover:border-[#C20E5A] rounded-xl p-4 text-center cursor-pointer hover:bg-pink-50/10 transition-all flex flex-col items-center justify-center gap-1.5"
                    >
                      <input 
                        type="file"
                        ref={faviconUploadInputRef}
                        onChange={handleFaviconUploadFileChange}
                        accept="image/png, image/x-icon, image/vnd.microsoft.icon, image/svg+xml, image/jpeg, image/jpg"
                        className="hidden"
                      />
                      <Upload className="w-5 h-5 text-gray-400" />
                      <span className="text-xs font-bold text-gray-700">Drag &amp; drop or click to upload</span>
                      <span className="text-[10px] text-gray-400">Square layout (1:1), PNG/ICO/SVG, Max 2MB</span>
                    </div>
                  </div>

                  {profile.customFaviconUrl && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          upd({ customFaviconUrl: undefined });
                          setFaviconMode('letter');
                          if (showToast) showToast('Custom favicon cleared, reverted to Character Favicon.', 'success');
                        }}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl border border-gray-200 hover:bg-rose-50 hover:text-rose-700 text-gray-600 text-xs font-bold transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove / Clear Custom Image</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right side: Browser Tab & Mockups Previews */}
            <div className="lg:col-span-7 bg-gray-50/50 border border-gray-100 rounded-2xl p-4 sm:p-5 flex flex-col justify-between">
              
              {/* Browser Tab Mockup */}
              <div className="bg-white border border-gray-200/80 rounded-xl overflow-hidden shadow-sm mb-5">
                {/* Browser bar */}
                <div className="bg-gray-100/80 px-4 py-2 border-b border-gray-200/80 flex items-center gap-1.5 shrink-0 select-none">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400 block" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 block" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 block" />
                  
                  {/* Active tab */}
                  <div className="ml-4 bg-white px-3 py-1.5 rounded-t-lg border-t border-x border-gray-200/80 flex items-center gap-2 max-w-[160px] truncate shadow-sm -mb-[9px] z-10">
                    <img 
                      src={
                        profile.customFaviconUrl ||
                        generateFaviconDataUrls(
                          profile.faviconColor || profile.customAccentColor || '#C20E5A',
                          profile.faviconLetter || profile.businessName?.trim().substring(0, 1) || 'N'
                        ).fav16
                      } 
                      alt="favicon-16" 
                      className="w-3.5 h-3.5 rounded-sm shadow-sm object-cover"
                    />
                    <span className="text-[10px] font-semibold text-gray-700 truncate">{profile.businessName || 'My Salon'}</span>
                  </div>
                </div>
                {/* Content preview area */}
                <div className="p-3 bg-gray-50/20 h-10 border-t border-gray-200/60 flex items-center px-4">
                  <div className="w-full bg-white border border-gray-200 rounded-full h-5 flex items-center px-3 text-[9px] text-gray-400 font-mono gap-1.5 truncate shadow-sm">
                    <span className="text-emerald-500">🔒</span>
                    <span className="text-gray-600 truncate">{siteUrl}</span>
                  </div>
                </div>
              </div>

              {/* Grid of size previews */}
              <div className="grid grid-cols-3 gap-4">
                
                {/* 16x16 */}
                <div className="rounded-xl border border-gray-200 bg-white p-3 flex flex-col items-center justify-center text-center shadow-sm">
                  <div className="h-10 flex items-center justify-center mb-1">
                    <img 
                      src={
                        profile.customFaviconUrl ||
                        generateFaviconDataUrls(
                          profile.faviconColor || profile.customAccentColor || '#C20E5A',
                          profile.faviconLetter || profile.businessName?.trim().substring(0, 1) || 'N'
                        ).fav16
                      } 
                      alt="favicon-16" 
                      className="w-4 h-4 rounded-sm shadow-sm object-cover"
                    />
                  </div>
                  <span className="text-[10px] font-bold text-gray-800">16x16</span>
                  <span className="text-[9px] text-gray-400">Tab Icon</span>
                </div>

                {/* 32x32 */}
                <div className="rounded-xl border border-gray-200 bg-white p-3 flex flex-col items-center justify-center text-center shadow-sm">
                  <div className="h-10 flex items-center justify-center mb-1">
                    <img 
                      src={
                        profile.customFaviconUrl ||
                        generateFaviconDataUrls(
                          profile.faviconColor || profile.customAccentColor || '#C20E5A',
                          profile.faviconLetter || profile.businessName?.trim().substring(0, 1) || 'N'
                        ).fav32
                      } 
                      alt="favicon-32" 
                      className="w-8 h-8 rounded-md shadow-sm object-cover"
                    />
                  </div>
                  <span className="text-[10px] font-bold text-gray-800">32x32</span>
                  <span className="text-[9px] text-gray-400">Desktop Icon</span>
                </div>

                {/* 180x180 */}
                <div className="rounded-xl border border-gray-200 bg-white p-3 flex flex-col items-center justify-center text-center shadow-sm">
                  <div className="h-10 flex items-center justify-center mb-1">
                    <img 
                      src={
                        profile.customFaviconUrl ||
                        generateFaviconDataUrls(
                          profile.faviconColor || profile.customAccentColor || '#C20E5A',
                          profile.faviconLetter || profile.businessName?.trim().substring(0, 1) || 'N'
                        ).apple180
                      } 
                      alt="apple-touch-180" 
                      className="w-10 h-10 rounded-lg shadow-sm object-cover"
                    />
                  </div>
                  <span className="text-[10px] font-bold text-gray-800">180x180</span>
                  <span className="text-[9px] text-gray-400">Apple Touch</span>
                </div>

              </div>

            </div>

          </div>
        </section>

        {/* ===== TYPOGRAPHY & GOOGLE FONTS CUSTOMIZER ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-6" id="website-editor-fonts-section">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Type className="w-4 h-4 text-[#C20E5A]" />
              <h2 className="font-display font-bold text-base">Website Typography</h2>
            </div>
            <span className="bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full">
              Google Fonts
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Choose custom typography to match your salon's unique brand mood. Changes apply dynamically to headings and body text on your site.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Heading Font Customizer */}
            <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold font-mono-caps text-gray-700 block">
                  Heading Typography
                </span>
                <span className="text-[10px] text-gray-400 font-medium font-sans">
                  h1, h2, h3, labels
                </span>
              </div>
              <div>
                <select
                  value={profile.headingFont || ''}
                  onChange={(e) => upd({ headingFont: e.target.value || undefined })}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none bg-white font-semibold text-gray-800"
                >
                  <option value="">Default (Manrope)</option>
                  {CURATED_GOOGLE_FONTS.map((font) => (
                    <option key={`head-${font.family}`} value={font.family}>
                      {font.name} ({font.category})
                    </option>
                  ))}
                </select>
              </div>
              <div className="bg-white p-3.5 rounded-lg border border-gray-150 min-h-[70px] flex flex-col justify-center">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Live Heading Preview</span>
                <span 
                  style={{ fontFamily: profile.headingFont ? `"${profile.headingFont}", sans-serif` : undefined }}
                  className="text-lg font-bold text-gray-900 leading-tight"
                >
                  {profile.businessName || 'Elite Styling Studio'}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 leading-normal">
                {profile.headingFont 
                  ? CURATED_GOOGLE_FONTS.find(f => f.family === profile.headingFont)?.description 
                  : 'Modern, balanced and geometric sans-serif headings.'
                }
              </p>
            </div>

            {/* Body Font Customizer */}
            <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold font-mono-caps text-gray-700 block">
                  Body &amp; Text Typography
                </span>
                <span className="text-[10px] text-gray-400 font-medium font-sans">
                  Descriptions, service list, forms
                </span>
              </div>
              <div>
                <select
                  value={profile.bodyFont || ''}
                  onChange={(e) => upd({ bodyFont: e.target.value || undefined })}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none bg-white font-semibold text-gray-800"
                >
                  <option value="">Default (Hanken Grotesk)</option>
                  {CURATED_GOOGLE_FONTS.map((font) => (
                    <option key={`body-${font.family}`} value={font.family}>
                      {font.name} ({font.category})
                    </option>
                  ))}
                </select>
              </div>
              <div className="bg-white p-3.5 rounded-lg border border-gray-150 min-h-[70px] flex flex-col justify-center">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Live Body Preview</span>
                <p 
                  style={{ fontFamily: profile.bodyFont ? `"${profile.bodyFont}", sans-serif` : undefined }}
                  className="text-xs text-gray-600 leading-relaxed font-normal"
                >
                  Book your haircut, styling, skin therapy, or custom bridal makeover easily online today.
                </p>
              </div>
              <p className="text-[10px] text-gray-400 leading-normal">
                {profile.bodyFont 
                  ? CURATED_GOOGLE_FONTS.find(f => f.family === profile.bodyFont)?.description 
                  : 'Friendly and highly readable sans-serif body text.'
                }
              </p>
            </div>
          </div>
        </section>

        {/* ===== SOCIAL SHARE IMAGE (OG:IMAGE) MANAGER ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-6" id="website-editor-social-share-section">
          <div className="flex items-center gap-2 mb-1">
            <Share2 className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Social Share Image (og:image)</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Manage your dedicated website social share card. This is the graphic that appears when clients share your website on WhatsApp, Twitter, Instagram, or iMessage.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left side: Upload & Generate Actions */}
            <div className="lg:col-span-5 space-y-4">
              {/* Upload Box */}
              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Upload Custom Social Image
                </label>
                <div 
                  onClick={() => socialShareInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 hover:border-[#C20E5A] rounded-xl p-4 text-center cursor-pointer hover:bg-pink-50/10 transition-all flex flex-col items-center justify-center gap-1.5"
                >
                  <input 
                    type="file"
                    ref={socialShareInputRef}
                    onChange={handleSocialShareFileChange}
                    accept="image/png, image/jpeg, image/jpg, image/webp"
                    className="hidden"
                  />
                  <Upload className="w-5 h-5 text-gray-400" />
                  <span className="text-xs font-bold text-gray-700">Drag &amp; drop or click to upload</span>
                  <span className="text-[10px] text-gray-400">1200x630 (1.91:1) recommended, Max 2MB</span>
                </div>
              </div>

              {/* AI Generator Box */}
              <div className="bg-pink-50/30 border border-pink-100 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-pink-600" />
                  <span className="text-xs font-bold text-gray-800">AI Branded Placeholder</span>
                </div>
                <p className="text-[10px] leading-relaxed text-gray-500">
                  Don't have a social image? Generate a stunning salon-branded card using your business details, tagline, and brand color instantly.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const dynamicUrl = generateSocialSharePlaceholder(profile);
                    if (dynamicUrl) {
                      upd({ socialShareImageUrl: dynamicUrl });
                      if (showToast) showToast('AI Salon-Branded share graphic generated!', 'success');
                    }
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#C20E5A] hover:bg-[#A30B4A] text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generate with AI</span>
                </button>
              </div>

              {/* Reset / Delete Custom Image */}
              {profile.socialShareImageUrl && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      upd({ socialShareImageUrl: undefined });
                      if (showToast) showToast('Social share image cleared. Site will use default cover image.', 'success');
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl border border-gray-200 hover:bg-rose-50 hover:text-rose-700 text-gray-600 text-xs font-bold transition-all cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Share Image</span>
                  </button>
                </div>
              )}
            </div>

            {/* Right side: Live Card Mockup Previews */}
            <div className="lg:col-span-7 bg-gray-50/50 border border-gray-100 rounded-2xl p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-3">
                  Live Social Share Card Preview (Facebook / WhatsApp / iMessage)
                </label>
                
                {/* Social Card Preview Component */}
                <div className="bg-white border border-gray-200/80 rounded-xl overflow-hidden shadow-sm max-w-[480px] mx-auto">
                  {/* Image Area (1.91:1) */}
                  <div className="relative aspect-[1.91/1] bg-slate-100 flex items-center justify-center overflow-hidden border-b border-gray-150">
                    {profile.socialShareImageUrl ? (
                      <img 
                        src={profile.socialShareImageUrl} 
                        alt="Social Share Card" 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      // Show AI auto-computed graphic live in the preview!
                      <img 
                        src={generateSocialSharePlaceholder(profile)} 
                        alt="AI Placeholder Preview" 
                        className="w-full h-full object-cover opacity-90 transition-opacity"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="absolute top-2.5 left-2.5 bg-slate-900/80 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                      <ImageIcon className="w-3 h-3" />
                      <span>{profile.socialShareImageUrl ? 'Custom Image Active' : 'AI Branded Placeholder Active'}</span>
                    </div>
                  </div>

                  {/* Metadata Area */}
                  <div className="p-3 bg-gray-50/50 text-left space-y-1">
                    <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">
                      {profile.subdomain || 'salon'}.nexora.in
                    </div>
                    <h4 className="text-xs font-bold text-gray-800 line-clamp-1">
                      {profile.businessName || 'My Premium Salon'} – {profile.tagline || 'Premium Salon Services'}
                    </h4>
                    <p className="text-[10px] leading-relaxed text-gray-500 line-clamp-2">
                      {profile.about || 'Book appointments, view services and check stylist availability online.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Status explanation */}
              <div className="mt-4 pt-3 border-t border-gray-150 text-[10px] leading-relaxed text-slate-500">
                <span className="font-bold text-slate-700">SEO &amp; OpenGraph Standard:</span>
                {profile.socialShareImageUrl ? (
                  <span> Your custom-uploaded share image is fully registered.</span>
                ) : (
                  <span> No image uploaded. The platform is automatically serving a high-resolution, salon-branded dynamic placeholder graphic using your active brand palette, tagline, and phone details.</span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ===== ADVANCED SEO KEYWORDS ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-6" id="website-editor-seo-keywords-section">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#C20E5A]" />
              <h2 className="font-display font-bold text-base">Search Engine Keywords (SEO)</h2>
            </div>
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full">
              Google &amp; Bing
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Boost your Google search relevance. Enter comma-separated terms related to your location, specialized styling, or products.
          </p>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1.5">
                SEO Keywords (Comma-Separated)
              </label>
              <textarea
                value={profile.seoKeywords || ''}
                onChange={(e) => upd({ seoKeywords: e.target.value })}
                placeholder="e.g. hair salon Mumbai, Balayage specialist Bandra, organic facials, bridal hair, Keratin treatment"
                rows={3}
                className="w-full p-3 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none resize-none font-sans"
              />
              <p className="text-[10px] text-gray-400 mt-1.5">
                Separate each phrase with a comma. These keywords are dynamically injected as a meta-keywords tag inside your website's header.
              </p>
            </div>

            {/* Keyword tag-pill previewer */}
            {profile.seoKeywords && profile.seoKeywords.trim().length > 0 && (
              <div className="bg-gray-50 border border-gray-150 rounded-xl p-3">
                <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider mb-2">Registered SEO Terms Preview</span>
                <div className="flex flex-wrap gap-1.5">
                  {profile.seoKeywords
                    .split(',')
                    .map((kw) => kw.trim())
                    .filter(Boolean)
                    .map((kw, idx) => (
                      <span key={idx} className="inline-flex items-center px-2 py-1 rounded-md bg-[#C20E5A]/5 border border-[#C20E5A]/10 text-[#C20E5A] text-[10px] font-medium shadow-sm">
                        🏷️ {kw}
                      </span>
                    ))
                  }
                </div>
              </div>
            )}
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
            Links for Instagram and Facebook will appear directly in your website header so visitors can follow and discover your portfolio.
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
            <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-slate-400 transition-all">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold font-mono-caps text-gray-700 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded bg-slate-950 text-white flex items-center justify-center text-[10px]">
                    <TikTokIcon className="w-3 h-3" />
                  </span>
                  <span>TikTok</span>
                </label>
                {profile.tiktokHandle && (
                  <a
                    href={formatTikTokUrl(profile.tiktokHandle)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-slate-700 hover:text-slate-900 hover:underline flex items-center gap-0.5"
                  >
                    <span>Test</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
              <input
                type="text"
                value={profile.tiktokHandle || ''}
                onChange={(e) => upd({ tiktokHandle: e.target.value })}
                placeholder="e.g. @arts_by_uma or url"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-xs font-mono bg-white focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
              <div className="text-[10px] text-gray-400 mt-1">
                {profile.tiktokHandle ? displaySocialHandle(profile.tiktokHandle) : 'Add handle or URL'}
              </div>
            </div>
          </div>
        </section>

        {/* ===== 4. SERVICES & PRICING ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-6">
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

                <div className="flex items-center gap-2 self-end md:self-center">
                  {/* Visual toggle switch for showDuration */}


                  <button
                    type="button"
                    onClick={() => removeService(srv.id)}
                    className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    title="Delete service"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-2xl p-6">
          <h2 className="font-bold">Opening Hours</h2>
          <p className="text-sm mt-2">Manage your daily opening times and weekly off in SaaS Dashboard → Appointments → Salon Opening Hours. Bookings use those saved hours.</p>
        </section>

        {/* ===== DIGITAL TOUCHPOINTS ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-1"><Globe className="w-4 h-4 text-[#C20E5A]" /><h2 className="font-display font-bold text-base">Website &amp; Digital Touchpoints</h2></div>
          <p className="text-[11px] text-gray-500 mb-4">Use this checklist to turn your brand story into a high-converting website experience.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { title: 'Hero / About Story', detail: 'Aim for 100–150 words focused on comfort, expertise, and authentic care.', ready: (profile.about || '').trim().split(/\s+/).filter(Boolean).length >= 100 },
              { title: 'Services & Pricing', detail: 'Give every service a clear 1–2 line, benefit-focused description.', ready: services.length > 0 && services.every((service) => (service.description || '').trim().length > 0) },
              { title: 'Social Proof & CTA', detail: 'Show transformations, before-and-after content, and a clear booking action.', ready: true },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-gray-200 p-3 bg-gray-50/60">
                <div className="flex items-center gap-2 mb-1"><CheckCircle2 className={`w-4 h-4 ${item.ready ? 'text-emerald-600' : 'text-gray-300'}`} /><span className="text-xs font-bold text-gray-800">{item.title}</span></div>
                <p className="text-[10px] leading-relaxed text-gray-500">{item.detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-[#C20E5A]/5 border border-[#C20E5A]/10 p-3">
            <div><p className="text-xs font-bold text-gray-800">Ready to review your customer journey?</p><p className="text-[10px] text-gray-500">Preview your story, service benefits, transformations, and booking CTA together.</p></div>
            <button type="button" onClick={onComplete} className="shrink-0 px-3 py-2 rounded-lg bg-[#C20E5A] text-white text-[11px] font-bold hover:opacity-90">View Preview</button>
          </div>
        </section>

        {/* ===== 5. TEMPLATE & LIVE SITE ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Template &amp; Live Website</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Pick a template (your data is preserved) and grab your white-label link.
          </p>
          <div className="mb-5 p-4 rounded-xl border border-amber-100 bg-amber-50/40">
            <div className="flex items-center gap-2 mb-1"><Sparkles className="w-4 h-4 text-amber-600" /><span className="text-xs font-bold text-gray-800">In-Salon Brand Experience</span></div>
            <p className="text-[10px] text-gray-500 mb-3">Make every visit feel consistent with your digital brand.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-[11px] font-bold text-gray-700">Scent Profile<select value={scentProfile} onChange={(e) => setScentProfile(e.target.value)} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white text-xs font-normal"><option>Jasmine &amp; White Tea</option><option>Eucalyptus &amp; Lavender</option><option>Citrus &amp; Cedar</option><option>Rose &amp; Sandalwood</option></select></label>
              <label className="text-[11px] font-bold text-gray-700">Soundscape<select value={soundscape} onChange={(e) => setSoundscape(e.target.value)} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white text-xs font-normal"><option>Lounge &amp; Acoustic Chill</option><option>Lo-fi Ambient</option><option>Soft Piano &amp; Spa</option><option>Upbeat Contemporary</option></select></label>
              <label className="text-[11px] font-bold text-gray-700">Consultation Style<select value={consultationStyle} onChange={(e) => setConsultationStyle(e.target.value)} className="mt-1 w-full p-2 rounded-lg border border-gray-200 bg-white text-xs font-normal"><option>Warm &amp; Personalised</option><option>Thorough &amp; Clinical</option><option>Express &amp; Efficient</option><option>Luxury Concierge</option></select></label>
            </div>
          </div>

          <div className="mb-5 p-4 rounded-xl border border-purple-100 bg-purple-50/50">
            <div className="flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-purple-600" /><span className="text-xs font-bold text-gray-800">AI Brand Identity Advisor</span></div>
            <div className="flex gap-2">
              <input value={brandFocus} onChange={(e) => setBrandFocus(e.target.value)} placeholder="e.g. Skin aesthetics, barbering, herbal spa" className="flex-1 p-2.5 rounded-xl border border-gray-200 text-xs outline-none focus:border-purple-500" />
              <button type="button" disabled={isBrandThinking || !brandFocus.trim()} onClick={async () => { setIsBrandThinking(true); try { const r = await fetch('/api/recommend-brand-identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessType: profile.businessType, focus: brandFocus }) }); const d = await r.json(); setBrandAdvice(d.advice || ''); } finally { setIsBrandThinking(false); } }} className="px-3 rounded-xl bg-purple-600 text-white text-xs font-bold disabled:opacity-50">{isBrandThinking ? 'Thinking…' : 'Recommend'}</button>
            </div>
            {brandAdvice && <p className="mt-3 text-xs leading-relaxed text-gray-700">{brandAdvice}</p>}
          </div>



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
        <div className="w-full bg-white border border-gray-200 rounded-2xl shadow-sm px-4 sm:px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            {isSaveFailed ? (
              <AlertCircle className="w-4 h-4 text-rose-500" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            )}
            <span>
              {isSavePending
                ? 'Auto-saving your changes…'
                : sessionExpired
                ? 'Your session expired — sign in again to publish to the cloud. Your edits are saved on this device.'
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
          onClose={() => {
            setSavedSiteUrl(null);
            setCompletionNote(null);
          }}
          onBackToDashboard={() => {
            setSavedSiteUrl(null);
            setCompletionNote(null);
            onBackToDashboard();
          }}
          completionNote={completionNote}
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

