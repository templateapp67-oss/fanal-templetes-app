import React, { useMemo, useRef, useState } from 'react';
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
  Play,
} from 'lucide-react';
import { SalonProfile, SalonService, BusinessTypeId } from '../types';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';
import { slugifySalonName } from '../lib/salonStore';
import { AIBioModal } from './AIBioModal';
import { supabase, isMockSupabase } from '../lib/supabaseClient';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface WebsiteEditorProps {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services: SalonService[];
  setServices: React.Dispatch<React.SetStateAction<SalonService[]>>;
  saveStatus: SaveStatus;
  onComplete: () => void;
  onSelectTemplate?: (catId: BusinessTypeId) => void;
  selectedTemplateId?: BusinessTypeId;
  siteUrl?: string;
  onSave?: () => void;
  showToast?: (message: string) => void;
}

const CATEGORY_OPTIONS = Object.values(CATEGORY_TEMPLATES);

const MAX_SHORTS = 5;
const MAX_LONG_VIDEOS = 5;

const YOUTUBE_SHORTS_URL_REGEX =
  /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})(?:[?&#].*)?$/i;

const YOUTUBE_VIDEO_URL_PATTERNS = [
  /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)([a-zA-Z0-9_-]{11})/i,
  /^(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
];

function extractShortVideoId(url: string): string | null {
  const match = url.trim().match(YOUTUBE_SHORTS_URL_REGEX);
  return match ? match[1] : null;
}

function extractVideoIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  for (const pattern of YOUTUBE_VIDEO_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export const WebsiteEditor: React.FC<WebsiteEditorProps> = ({
  profile,
  setProfile,
  services,
  setServices,
  saveStatus,
  onComplete,
  onSelectTemplate,
  selectedTemplateId,
  siteUrl,
  onSave,
  showToast,
}) => {
  const [copied, setCopied] = useState(false);
  const [isBioModalOpen, setIsBioModalOpen] = useState(false);

  // -- YouTube Management ---------------------------------------------------
  interface YtVideoRow {
    id?: string;
    video_type: 'short' | 'long';
    youtube_url: string;
    youtube_video_id: string;
    title: string;
    thumbnail_url?: string;
    description?: string;
    like_count?: number;
    comment_count?: number;
  }

  const [shorts, setShorts] = useState<YtVideoRow[]>([]);
  const [longVideos, setLongVideos] = useState<YtVideoRow[]>([]);
  const [shortUrlInput, setShortUrlInput] = useState('');
  const [longUrlInput, setLongUrlInput] = useState('');
  const [fetchStatus, setFetchStatus] = useState<string | null>(null);
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [isLoadingVideos, setIsLoadingVideos] = useState(true);

  // Keep live refs alongside state so the max-5 checks stay accurate even when
  // multiple add actions happen quickly, without relying on a stale closure.
  const shortsRef = useRef<YtVideoRow[]>([]);
  const longVideosRef = useRef<YtVideoRow[]>([]);

  const loadYouTubeVideos = async () => {
    setIsLoadingVideos(true);
    try {
      // Try to load from DB; fall back to empty arrays in mock mode
      let shortsData: any[] = [];
      let longData: any[] = [];
      if (!isMockSupabase) {
        const { data: sData } = await supabase
          .from('salon_youtube_videos')
          .select('*')
          .eq('video_type', 'short');
        const { data: lData } = await supabase
          .from('salon_youtube_videos')
          .select('*')
          .eq('video_type', 'long');
        shortsData = sData || [];
        longData = lData || [];
      }
      const shortsRows = (shortsData || []).map((r: any) => ({
        id: r.id,
        video_type: r.video_type as 'short',
        youtube_url: r.youtube_url,
        youtube_video_id: r.youtube_video_id,
        title: r.title || '',
        thumbnail_url: r.thumbnail_url,
        description: r.description,
        like_count: r.like_count,
        comment_count: r.comment_count,
      }));
      const longRows = (longData || []).map((r: any) => ({
        id: r.id,
        video_type: r.video_type as 'long',
        youtube_url: r.youtube_url,
        youtube_video_id: r.youtube_video_id,
        title: r.title || '',
        thumbnail_url: r.thumbnail_url,
        description: r.description,
        like_count: r.like_count,
        comment_count: r.comment_count,
      }));
      shortsRef.current = shortsRows;
      longVideosRef.current = longRows;
      setShorts(shortsRows);
      setLongVideos(longRows);
    } catch (err) {
      console.warn('Failed to load YouTube videos:', err);
    } finally {
      setIsLoadingVideos(false);
    }
  };

  const handleFetchMeta = async (url: string, type: 'short' | 'long') => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    // Validate the link client-side before calling the API. Shorts must use the
    // /shorts/ URL format so a long video cannot be added to the Shorts list.
    if (type === 'short') {
      const shortsVideoId = extractShortVideoId(trimmedUrl);
      if (!shortsVideoId) {
        setFetchStatus(
          'Invalid YouTube Shorts URL. Please paste a link like https://www.youtube.com/shorts/VIDEO_ID.'
        );
        return;
      }
    } else {
      const videoId = extractVideoIdFromUrl(trimmedUrl);
      if (!videoId) {
        setFetchStatus(
          'Invalid YouTube video URL. Supported formats: youtube.com/watch?v=..., youtube.com/shorts/..., youtu.be/...'
        );
        return;
      }
    }

    // Enforce the 5-video limit with the live refs so rapid clicks cannot exceed it.
    const currentCount = type === 'short' ? shortsRef.current.length : longVideosRef.current.length;
    const maxAllowed = type === 'short' ? MAX_SHORTS : MAX_LONG_VIDEOS;
    if (currentCount >= maxAllowed) {
      setFetchStatus(
        type === 'short'
          ? 'Shorts limit reached (max 5). Delete one to add another.'
          : 'Long Videos limit reached (max 5). Delete one to add another.'
      );
      return;
    }

    setIsFetchingMeta(true);
    setFetchStatus('Fetching metadata from YouTube...');
    try {
      const res = await fetch('/api/fetch-youtube-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeUrl: trimmedUrl }),
      });
      const data = await res.json();
      if (data.success && data.videoId) {
        // Re-check after the async fetch because another request may have
        // already filled the slot while this one was in flight.
        if (
          (type === 'short' && shortsRef.current.length >= MAX_SHORTS) ||
          (type === 'long' && longVideosRef.current.length >= MAX_LONG_VIDEOS)
        ) {
          setFetchStatus(
            type === 'short'
              ? 'Shorts limit reached (max 5). Delete one to add another.'
              : 'Long Videos limit reached (max 5). Delete one to add another.'
          );
          return;
        }

        const newRow: YtVideoRow = {
          video_type: type,
          youtube_url: data.youtubeUrl || trimmedUrl,
          youtube_video_id: data.videoId,
          title: data.title || '',
          thumbnail_url: data.thumbnailUrl || '',
          description: data.description || '',
          like_count: data.likeCount || 0,
          comment_count: data.commentCount || 0,
        };

        if (type === 'short') {
          const updated = [...shortsRef.current, newRow];
          shortsRef.current = updated;
          setShorts(updated);
          setShortUrlInput('');
        } else {
          const updated = [...longVideosRef.current, newRow];
          longVideosRef.current = updated;
          setLongVideos(updated);
          setLongUrlInput('');
        }

        // Async save after state update
        setTimeout(() => handleSaveVideoToDb(newRow), 100);
        setFetchStatus('Video metadata fetched and added!');
      } else {
        setFetchStatus(data.notice || 'Failed to fetch metadata.');
      }
    } catch (err: any) {
      console.warn('Fetch meta error:', err);
      setFetchStatus('Failed to fetch YouTube metadata.');
    } finally {
      setIsFetchingMeta(false);
      setTimeout(() => setFetchStatus(null), 4000);
    }
  };

  const handleSaveVideoToDb = async (video: YtVideoRow) => {
    try {
      if (isMockSupabase) {
        // In mock mode just keep in local state (already added)
        showToast?.('Video saved locally (mock mode).');
        return;
      }
      // Save to salon_youtube_videos
      // We don't have salon_id from profile directly mapped to DB id; use profile.subdomain or a placeholder
      // For simplicity, assume profile.id exists or use a mock owner mapping
      const ownerId = (profile as any)?.ownerId || profile.subdomain || 'mock-owner';
      const { error } = await supabase.from('salon_youtube_videos').insert({
        salon_id: ownerId,
        video_type: video.video_type,
        youtube_url: video.youtube_url,
        youtube_video_id: video.youtube_video_id,
        title: video.title,
        thumbnail_url: video.thumbnail_url,
        description: video.description,
        like_count: video.like_count || 0,
        comment_count: video.comment_count || 0,
      });
      if (error) {
        console.warn('DB insert error:', error);
        showToast?.('Failed to save video to database.');
      } else {
        showToast?.('Video saved to database!');
        await loadYouTubeVideos();
      }
    } catch (err: any) {
      console.warn('Save video error:', err);
      showToast?.('Failed to save video.');
    }
  };

  const handleDeleteVideo = async (id: string, type: 'short' | 'long') => {
    try {
      if (!isMockSupabase && id && id.length > 10) {
        const { error } = await supabase.from('salon_youtube_videos').delete().eq('id', id);
        if (error) console.warn('DB delete error:', error);
      }
      if (type === 'short') {
        const updated = shortsRef.current.filter((v) => v.id !== id && v.youtube_video_id !== id);
        shortsRef.current = updated;
        setShorts(updated);
      } else {
        const updated = longVideosRef.current.filter((v) => v.id !== id && v.youtube_video_id !== id);
        longVideosRef.current = updated;
        setLongVideos(updated);
      }
      showToast?.('Video deleted.');
      await loadYouTubeVideos();
    } catch (err) {
      console.warn('Delete video error:', err);
    }
  };

  // Load videos on mount
  React.useEffect(() => {
    loadYouTubeVideos();
  }, []);

  const upd = (patch: Partial<SalonProfile>) =>
    setProfile((prev) => ({ ...prev, ...patch }));

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

  const handleCopyLink = () => {
    if (!siteUrl) return;
    navigator.clipboard?.writeText(siteUrl);
    setCopied(true);
    showToast?.('Website link copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    onSave?.();
    showToast?.('Website details updated successfully!');
  };

  const subCategories =
    CATEGORY_TEMPLATES[selectedTemplateId || profile.businessType]?.subCategories || [];

  const saveLabel =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'error'
      ? 'Save failed'
      : saveStatus === 'saved'
      ? 'Auto-Saved'
      : 'All changes saved';

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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                saveStatus === 'saving'
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : saveStatus === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : saveStatus === 'saved'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              {saveStatus === 'saving' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : saveStatus === 'error' ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>{saveLabel}</span>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#C20E5A] hover:bg-[#A30B4A] disabled:opacity-60 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
            >
              {saveStatus === 'saving' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>Save &amp; Update Website</span>
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
                  <span>Write with AI</span>
                </button>
              </div>
              <textarea
                rows={3}
                value={profile.about}
                onChange={(e) => upd({ about: e.target.value })}
                placeholder="Tell clients what makes your salon special…"
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
                placeholder="e.g. Ananya Sharma"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Owner Role / Title
              </label>
              <input
                type="text"
                value={profile.ownerRole}
                onChange={(e) => upd({ ownerRole: e.target.value })}
                placeholder="e.g. Founder & Lead Stylist"
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
            These power your click-to-call, WhatsApp booking and the map on your website.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Phone Number <span className="text-rose-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) => upd({ phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="flex-1 p-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                WhatsApp / Booking Line
              </label>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  type="text"
                  value={profile.whatsapp}
                  onChange={(e) => upd({ whatsapp: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="flex-1 p-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Email Address
              </label>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  type="email"
                  value={profile.email}
                  onChange={(e) => upd({ email: e.target.value })}
                  placeholder="hello@yoursalon.com"
                  className="flex-1 p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                City
              </label>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  type="text"
                  value={profile.city}
                  onChange={(e) => upd({ city: e.target.value })}
                  placeholder="Mumbai"
                  className="flex-1 p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Postal PIN Code
              </label>
              <input
                type="text"
                value={profile.postalCode}
                onChange={(e) => upd({ postalCode: e.target.value })}
                placeholder="400001"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Full Address
              </label>
              <input
                type="text"
                value={profile.address}
                onChange={(e) => upd({ address: e.target.value })}
                placeholder="Shop No. 12, Crystal Plaza, MG Road"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Landmark
              </label>
              <input
                type="text"
                value={profile.landmark || ''}
                onChange={(e) => upd({ landmark: e.target.value })}
                placeholder="Near City Mall"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Instagram Handle
              </label>
              <input
                type="text"
                value={profile.instagramHandle}
                onChange={(e) => upd({ instagramHandle: e.target.value.replace('@', '') })}
                placeholder="@yourstudio"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>
          </div>
        </section>

        {/* ===== 3. SERVICES & PRICING ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-[#C20E5A]" />
              <h2 className="font-display font-bold text-base">Services &amp; Pricing</h2>
            </div>
            <button
              type="button"
              onClick={addService}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Service</span>
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            These appear on your public menu with INR (₹) pricing and duration.
          </p>

          <div className="flex flex-col gap-3">
            {services.map((srv) => (
              <div
                key={srv.id}
                className="border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-start sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={srv.name}
                    onChange={(e) => updateService(srv.id, { name: e.target.value })}
                    placeholder="Service name"
                    className="w-full p-2 rounded-lg border border-gray-300 text-sm font-bold focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none mb-2"
                  />
                  <select
                    value={srv.category}
                    onChange={(e) => updateService(srv.id, { category: e.target.value })}
                    className="w-full sm:w-40 p-2 rounded-lg border border-gray-300 text-xs text-gray-700 focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                  >
                    {(subCategories.length ? subCategories : ['Hair', 'Spa', 'Care']).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-gray-500">₹</span>
                    <input
                      type="number"
                      value={srv.price}
                      onChange={(e) => updateService(srv.id, { price: Number(e.target.value) || 0 })}
                      placeholder="500"
                      className="w-24 p-2 rounded-lg border border-gray-300 text-sm font-mono text-right focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={srv.durationMinutes}
                      onChange={(e) => updateService(srv.id, { durationMinutes: Number(e.target.value) || 0 })}
                      placeholder="45"
                      className="w-20 p-2 rounded-lg border border-gray-300 text-sm font-mono text-right focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                    />
                    <span className="text-[10px] font-mono text-gray-400">min</span>
                  </div>
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

            {services.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-8">
                No services yet. Add your first service to display it on the menu.
              </div>
            )}
          </div>
        </section>

        {/* ===== 4. WORKING HOURS ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Timings</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Shown in the location &amp; operating-hours section of your website.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Monday – Friday
              </label>
              <input
                type="text"
                value={profile.workingHoursMonFri || ''}
                onChange={(e) => upd({ workingHoursMonFri: e.target.value })}
                placeholder="10:00 AM – 08:00 PM"
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
                placeholder="10:00 AM – 08:00 PM"
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

        {/* ===== 6. YOUTUBE MANAGEMENT (SHORTS & LONG) ===== */}
        <section className="bg-gradient-to-r from-rose-950/5 via-slate-900/5 to-amber-950/5 border border-rose-200/40 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <Play className="w-4 h-4 text-rose-600" />
            <h2 className="font-display font-bold text-base text-gray-900">YouTube Videos &amp; Shorts</h2>
            <span className="text-[10px] font-mono font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">Admin Only</span>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Manage up to 5 Shorts and 5 Long Videos that appear on your live site feed.
          </p>

          {/* SHORTS SECTION */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-rose-700 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                Shorts (Max 5)
              </h3>
              <span className="text-[10px] font-mono text-gray-500">
                {shorts.length} / 5
              </span>
            </div>

            {/* Input */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={shortUrlInput}
                onChange={(e) => setShortUrlInput(e.target.value)}
                placeholder="Social Proof & Reels Showcase — Paste YouTube Shorts URL (e.g. https://www.youtube.com/shorts/...)"
                aria-label="Shorts YouTube URL"
                autoComplete="off"
                className="flex-1 p-2.5 rounded-xl border border-rose-200 text-xs focus:ring-2 focus:ring-rose-300 focus:border-rose-400 outline-none bg-rose-50/30"
              />
              <button
                type="button"
                onClick={() => handleFetchMeta(shortUrlInput, 'short')}
                disabled={!shortUrlInput.trim() || shorts.length >= 5 || isFetchingMeta}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-sm"
              >
                {isFetchingMeta ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>Add Short</span>
              </button>
            </div>

            {fetchStatus && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-xl text-[11px] font-medium mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-rose-600">info</span>
                <span>{fetchStatus}</span>
              </div>
            )}

            {/* List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {shorts.map((v) => (
                <div key={v.id || v.youtube_video_id} className="relative p-3 rounded-xl bg-white border border-rose-100 shadow-xs hover:shadow-md transition-all">
                  <div className="flex gap-3">
                    <img src={v.thumbnail_url || `https://img.youtube.com/vi/${v.youtube_video_id}/hqdefault.jpg`} alt={v.title} className="w-20 h-14 rounded-lg object-cover border border-gray-200 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-xs text-gray-900 truncate">{v.title || 'Untitled'}</h4>
                      <p className="text-[10px] text-gray-500 truncate">{v.description || 'No description'}</p>
                      <div className="flex items-center gap-1 mt-1 text-[9px] text-gray-400 font-mono">
                        <span>{v.like_count || 0} likes</span>
                        <span>·</span>
                        <span>{v.comment_count || 0} comments</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-rose-50">
                    <a href={v.youtube_url} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-rose-600 hover:text-rose-800 underline">{v.youtube_video_id}</a>
                    <button
                      type="button"
                      onClick={() => handleDeleteVideo(v.id || v.youtube_video_id, 'short')}
                      className="text-[10px] font-bold text-rose-500 hover:text-rose-700 px-2 py-0.5 rounded hover:bg-rose-50 transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {shorts.length === 0 && (
              <div className="text-center text-xs text-gray-400 py-4 border border-dashed border-rose-200 rounded-xl">
                No Shorts added. Paste a YouTube Shorts URL above.
              </div>
            )}
          </div>

          {/* LONG VIDEOS SECTION */}
          <div className="pt-6 border-t border-rose-200/40">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-sky-700 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                Long Videos (Max 5)
              </h3>
              <span className="text-[10px] font-mono text-gray-500">
                {longVideos.length} / 5
              </span>
            </div>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={longUrlInput}
                onChange={(e) => setLongUrlInput(e.target.value)}
                placeholder="Paste YouTube video URL (e.g. https://www.youtube.com/watch?v=...)"
                aria-label="Long YouTube video URL"
                autoComplete="off"
                className="flex-1 p-2.5 rounded-xl border border-sky-200 text-xs focus:ring-2 focus:ring-sky-300 focus:border-sky-400 outline-none bg-sky-50/30"
              />
              <button
                type="button"
                onClick={() => handleFetchMeta(longUrlInput, 'long')}
                disabled={!longUrlInput.trim() || longVideos.length >= 5 || isFetchingMeta}
                className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-sm"
              >
                {isFetchingMeta ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>Add Video</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {longVideos.map((v) => (
                <div key={v.id || v.youtube_video_id} className="relative p-3 rounded-xl bg-white border border-sky-100 shadow-xs hover:shadow-md transition-all">
                  <div className="flex gap-3">
                    <img src={v.thumbnail_url || `https://img.youtube.com/vi/${v.youtube_video_id}/hqdefault.jpg`} alt={v.title} className="w-20 h-14 rounded-lg object-cover border border-gray-200 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-xs text-gray-900 truncate">{v.title || 'Untitled'}</h4>
                      <p className="text-[10px] text-gray-500 truncate">{v.description || 'No description'}</p>
                      <div className="flex items-center gap-1 mt-1 text-[9px] text-gray-400 font-mono">
                        <span>{v.like_count || 0} likes</span>
                        <span>·</span>
                        <span>{v.comment_count || 0} comments</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-sky-50">
                    <a href={v.youtube_url} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-sky-600 hover:text-sky-800 underline">{v.youtube_video_id}</a>
                    <button
                      type="button"
                      onClick={() => handleDeleteVideo(v.id || v.youtube_video_id, 'long')}
                      className="text-[10px] font-bold text-sky-500 hover:text-sky-700 px-2 py-0.5 rounded hover:bg-sky-50 transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {longVideos.length === 0 && (
              <div className="text-center text-xs text-gray-400 py-4 border border-dashed border-sky-200 rounded-xl">
                No Long Videos added. Paste a YouTube video URL above.
              </div>
            )}
          </div>
        </section>

        {/* ===== BOTTOM SAVE BAR ===== */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            {saveStatus === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-500" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            )}
            <span>
              {saveStatus === 'error'
                ? 'We couldn’t save your changes. Please try again.'
                : 'Your details are saved and already reflected in the live preview.'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#C20E5A] hover:bg-[#A30B4A] disabled:opacity-60 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            {saveStatus === 'saving' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>Save &amp; Update Website</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Count of fields for transparency (dedup guard) */}
        <p className="text-center text-[10px] text-gray-400 font-mono">
          One form • Each field asked once • Auto-synced with the live template
        </p>
      </div>

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
